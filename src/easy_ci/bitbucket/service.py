"""Opérations Bitbucket Pipelines (Bitbucket Cloud) utilisées par l'interface."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import quote

import httpx

from easy_ci import logs
from easy_ci.bitbucket import normalize
from easy_ci.errors import EasyCIError, ForbiddenError, NotFoundError
from easy_ci.http import ApiClient
from easy_ci.providers import BITBUCKET, PROVIDER_INFO, RECENT_RUNS, build_scan, empty_scan
from easy_ci.state import FAILURE, QUEUED, RUNNING
from easy_ci.workflow_yaml import summarize_bitbucket_pipelines

API_URL = "https://api.bitbucket.org/2.0"


class BitbucketClient(ApiClient):
    """Authentification par e-mail Atlassian + API token (Basic), ou par access token de workspace/dépôt (Bearer)."""

    def __init__(
        self,
        *,
        email: str | None = None,
        api_token: str | None = None,
        access_token: str | None = None,
        base_url: str = API_URL,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 20.0,
    ) -> None:
        if access_token:
            super().__init__(base_url, label="Bitbucket", headers={"Authorization": f"Bearer {access_token}"}, transport=transport, timeout=timeout)
        elif email and api_token:
            super().__init__(base_url, label="Bitbucket", auth=(email, api_token), transport=transport, timeout=timeout)
        else:
            raise EasyCIError("Renseignez l'e-mail du compte Atlassian et l'API token, ou un access token.")


def _uuid(value: str) -> str:
    return quote(value, safe="")


def _next(data: dict[str, Any]) -> str | None:
    return data.get("next")


class BitbucketService:
    provider = BITBUCKET

    def __init__(self, client: BitbucketClient) -> None:
        self._client = client
        self._repos: dict[str, dict[str, Any]] = {}
        self._commits: dict[str, dict[str, Any]] = {}
        self._logs: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="bitbucket")

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
        self._client.close()

    # -- Compte -----------------------------------------------------------

    def get_user(self) -> dict[str, Any]:
        return normalize.user(self._client.get_json("/user"))

    def rate_limit(self) -> dict[str, int] | None:
        return self._client.rate_limit

    # -- Dépôts -----------------------------------------------------------

    def list_repositories(self) -> list[dict[str, Any]]:
        raw = self._client.paginate(
            "/repositories", {"role": "member", "sort": "-updated_on", "pagelen": 100}, key="values", next_from_body=_next
        )
        repositories = [normalize.repository(item) for item in raw]
        with self._lock:
            self._repos.update({repo["full_name"].lower(): repo for repo in repositories})
        return repositories

    def get_repository(self, full_name: str) -> dict[str, Any]:
        repo = normalize.repository(self._client.get_json(f"/repositories/{full_name}"))
        with self._lock:
            self._repos[full_name.lower()] = repo
        return repo

    def _repo(self, full_name: str) -> dict[str, Any]:
        with self._lock:
            cached = self._repos.get(full_name.lower())
        return cached or self.get_repository(full_name)

    # -- Pipelines --------------------------------------------------------

    def scan_repository(self, full_name: str) -> dict[str, Any]:
        repo = self._repo(full_name)
        try:
            data = self._client.get_json(f"/repositories/{full_name}/pipelines/", {"sort": "-created_on", "pagelen": 30})
        except (NotFoundError, ForbiddenError):
            data = {"values": []}
        raw_pipelines = data.get("values", [])
        if not raw_pipelines and not self._config_exists(full_name, repo["default_branch"]):
            return empty_scan(full_name)

        runs = self._enrich(full_name, raw_pipelines, limit=RECENT_RUNS)
        workflow = {
            "id": normalize.WORKFLOW_ID,
            "name": "Pipelines",
            "path": normalize.CONFIG_PATH,
            "state": "active",
            "html_url": f"{repo['html_url']}/pipelines",
            "dynamic": False,
        }
        return build_scan(full_name, [workflow], runs)

    def list_runs(
        self,
        full_name: str,
        workflow_id: str | None = None,
        branch: str | None = None,
        status: str | None = None,
        page: int = 1,
        per_page: int = 30,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"sort": "-created_on", "page": page, "pagelen": per_page}
        if branch:
            params["target.branch"] = branch
        data = self._client.get_json(f"/repositories/{full_name}/pipelines/", params)
        runs = self._enrich(full_name, data.get("values", []), limit=per_page)
        if status:
            # Filtrage local : les états Bitbucket ne correspondent pas un pour un aux filtres de l'interface.
            runs = [run for run in runs if run["state"] == status]
        total = data.get("size", len(runs))
        return {"runs": runs, "total_count": total, "page": page, "has_more": bool(data.get("next"))}

    def get_run(self, full_name: str, run_id: str) -> dict[str, Any]:
        base = f"/repositories/{full_name}/pipelines/{_uuid(run_id)}"
        raw = self._client.get_json(base)
        steps = self._client.paginate(f"{base}/steps/", {"pagelen": 100}, key="values", next_from_body=_next)
        commit = self._commit(full_name, ((raw.get("target") or {}).get("commit") or {}).get("hash"))
        return {
            "run": normalize.pipeline(raw, full_name, commit),
            "jobs": [normalize.step(item, full_name, raw) for item in steps],
            "capabilities": PROVIDER_INFO[BITBUCKET]["capabilities"],
        }

    def get_job_log(self, full_name: str, job_id: str) -> dict[str, Any]:
        with self._lock:
            cached = self._logs.get(job_id)
        if cached:
            return cached
        pipeline_uuid, step_uuid = self._split_job_id(job_id)
        base = f"/repositories/{full_name}/pipelines/{_uuid(pipeline_uuid)}/steps/{_uuid(step_uuid)}"
        raw_step = self._client.get_json(base)
        pipeline_raw = {"uuid": pipeline_uuid, "build_number": None}
        step = normalize.step(raw_step, full_name, pipeline_raw)
        if step["state"] == QUEUED and not step["started_at"]:
            return {"available": False}
        try:
            text = self._client.get_text(f"{base}/log")
        except NotFoundError:
            return {"available": False}
        complete = step["state"] not in (RUNNING, QUEUED)
        parsed = {"available": True, "complete": complete, **logs.parse_log(mark_commands(text), failed=step["state"] == FAILURE, collapse_groups=False)}
        if complete:
            with self._lock:
                self._logs[job_id] = parsed
        return parsed

    def get_job_annotations(self, full_name: str, job_id: str) -> list[dict[str, Any]]:
        return []

    def rerun_run(self, full_name: str, run_id: str, failed_only: bool = False) -> dict[str, str]:
        """Bitbucket ne relance pas un pipeline existant : un nouveau est créé sur la même cible."""
        raw = self._client.get_json(f"/repositories/{full_name}/pipelines/{_uuid(run_id)}")
        target = raw.get("target") or {}
        if target.get("type") == "pipeline_pullrequest_target":
            payload_target = {
                key: target[key]
                for key in ("type", "source", "destination", "destination_commit", "commit", "pullrequest", "selector")
                if key in target
            }
        else:
            payload_target = {key: target[key] for key in ("type", "ref_type", "ref_name", "selector") if key in target}
        if not payload_target.get("ref_name") and payload_target.get("type") != "pipeline_pullrequest_target":
            raise EasyCIError("Ce pipeline ne peut pas être relancé depuis Easy CI (cible inconnue). Relancez-le depuis Bitbucket.")
        created = self._client.post(f"/repositories/{full_name}/pipelines/", json={"target": payload_target}) or {}
        return {"run_id": created.get("uuid", run_id)}

    def cancel_run(self, full_name: str, run_id: str) -> None:
        self._client.post(f"/repositories/{full_name}/pipelines/{_uuid(run_id)}/stopPipeline")

    # -- Fichiers ---------------------------------------------------------

    def get_workflow_file(self, full_name: str, path: str, ref: str | None = None) -> dict[str, Any]:
        repo = self._repo(full_name)
        ref = ref or repo["default_branch"]
        content = self._client.get_text(f"/repositories/{full_name}/src/{quote(ref, safe='')}/{path}")
        return {
            "path": path,
            "sha": None,
            "html_url": f"{repo['html_url']}/src/{ref}/{path}",
            "content": content,
            "summary": summarize_bitbucket_pipelines(content),
        }

    # -- Interne ----------------------------------------------------------

    @staticmethod
    def _split_job_id(job_id: str) -> tuple[str, str]:
        pipeline_uuid, sep, step_uuid = job_id.partition(":")
        if not sep:
            raise EasyCIError("Identifiant de step Bitbucket invalide.")
        return pipeline_uuid, step_uuid

    def _config_exists(self, full_name: str, branch: str) -> bool:
        try:
            self._client.get_text(f"/repositories/{full_name}/src/{quote(branch, safe='')}/{normalize.CONFIG_PATH}")
            return True
        except (NotFoundError, ForbiddenError, EasyCIError):
            return False

    def _commit(self, full_name: str, sha: str | None) -> dict[str, Any] | None:
        if not sha:
            return None
        with self._lock:
            cached = self._commits.get(sha)
        if cached:
            return cached
        try:
            commit = self._client.get_json(f"/repositories/{full_name}/commit/{sha}")
        except (NotFoundError, ForbiddenError):
            return None
        with self._lock:
            self._commits[sha] = commit
        return commit

    def _enrich(self, full_name: str, raw_pipelines: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
        def enrich(raw: dict[str, Any]) -> dict[str, Any]:
            sha = ((raw.get("target") or {}).get("commit") or {}).get("hash")
            return normalize.pipeline(raw, full_name, self._commit(full_name, sha))

        head = list(self._pool.map(enrich, raw_pipelines[:limit]))
        return head + [normalize.pipeline(raw, full_name) for raw in raw_pipelines[limit:]]


def mark_commands(text: str) -> str:
    """Dans les logs Bitbucket, chaque commande du script commence par « + » : on en fait des sections."""
    return "\n".join(f"##[group]{line}" if line.startswith("+ ") else line for line in text.split("\n"))
