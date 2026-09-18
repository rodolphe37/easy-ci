"""Opérations GitLab CI/CD (gitlab.com ou instance auto-hébergée) utilisées par l'interface."""

from __future__ import annotations

import base64
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import quote

import httpx

from easy_ci import logs
from easy_ci.compare import commit_entry, commit_range, file_entry
from easy_ci.errors import EasyCIError, ForbiddenError, NotFoundError
from easy_ci.gitlab import normalize
from easy_ci.http import ApiClient
from easy_ci.i18n import tr
from easy_ci.providers import ACTIVITY_DEPTH, GITLAB, RECENT_RUNS, activity_fingerprint, build_scan, capabilities, empty_scan
from easy_ci.state import FAILURE, QUEUED, RUNNING
from easy_ci.workflow_yaml import summarize_gitlab_ci

DEFAULT_HOST = "https://gitlab.com"
_FINISHED = {"success", "failed", "canceled", "skipped", "manual"}


def normalize_host(host: str | None) -> str:
    """« gitlab.exemple.fr/ » → « https://gitlab.exemple.fr »."""
    value = (host or DEFAULT_HOST).strip().rstrip("/")
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    return value.removesuffix("/api/v4")


class GitLabClient(ApiClient):
    def __init__(self, token: str, *, host: str = DEFAULT_HOST, transport: httpx.BaseTransport | None = None, timeout: float = 20.0) -> None:
        self.host = normalize_host(host)
        super().__init__(f"{self.host}/api/v4", label="GitLab", headers={"PRIVATE-TOKEN": token}, transport=transport, timeout=timeout)


class GitLabService:
    provider = GITLAB

    def __init__(self, client: GitLabClient) -> None:
        self._client = client
        self._projects: dict[str, dict[str, Any]] = {}
        self._commits: dict[str, dict[str, Any]] = {}
        self._pipelines: dict[str, dict[str, Any]] = {}  # détails des pipelines terminés
        self._logs: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="gitlab")

    @property
    def host(self) -> str:
        return self._client.host

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
        self._client.close()

    # -- Compte -----------------------------------------------------------

    def get_user(self) -> dict[str, Any]:
        return normalize.user(self._client.get_json("/user"))

    def rate_limit(self) -> dict[str, int] | None:
        return self._client.rate_limit

    # -- Projets ----------------------------------------------------------

    def list_repositories(self) -> list[dict[str, Any]]:
        raw = self._client.paginate("/projects", {"membership": "true", "order_by": "last_activity_at", "sort": "desc", "per_page": 100})
        repositories = []
        for item in raw:
            repo = normalize.repository(item)
            self._remember(repo)
            repositories.append(repo)
        return repositories

    def get_repository(self, full_name: str) -> dict[str, Any]:
        repo = normalize.repository(self._client.get_json(f"/projects/{quote(full_name, safe='')}"))
        self._remember(repo)
        return repo

    def _remember(self, repo: dict[str, Any]) -> None:
        with self._lock:
            self._projects[repo["full_name"].lower()] = repo

    def _project(self, full_name: str) -> dict[str, Any]:
        with self._lock:
            cached = self._projects.get(full_name.lower())
        return cached or self.get_repository(full_name)

    def _base(self, full_name: str) -> str:
        return f"/projects/{self._project(full_name)['id']}"

    # -- Pipelines --------------------------------------------------------

    def scan_repository(self, full_name: str) -> dict[str, Any]:
        project = self._project(full_name)
        base = self._base(full_name)
        try:
            raw_pipelines = self._client.get_json(f"{base}/pipelines", _PIPELINES_PARAMS)
        except ForbiddenError:
            # CI/CD désactivé sur le projet ou droits insuffisants.
            return empty_scan(full_name)

        config_path = project["ci_config_path"]
        remote_config = "@" in config_path or config_path.startswith("http")
        if not raw_pipelines and not remote_config and not self._file_exists(base, config_path, project["default_branch"]):
            return empty_scan(full_name)

        runs = self._enrich(full_name, raw_pipelines, limit=RECENT_RUNS)
        workflow = {
            "id": normalize.WORKFLOW_ID,
            "name": "Pipeline",
            "path": config_path,
            "state": "active",
            "html_url": f"{project['html_url']}/-/pipelines",
            "dynamic": remote_config,
        }
        return build_scan(full_name, [workflow], runs)

    def run_activity(self, full_name: str) -> str:
        """Empreinte des pipelines récents (même requête que le scan, qui profite de son ETag)."""
        try:
            raw_pipelines = self._client.get_json(f"{self._base(full_name)}/pipelines", _PIPELINES_PARAMS)
        except (ForbiddenError, NotFoundError):
            return activity_fingerprint([])
        return activity_fingerprint((p.get("id"), p.get("status"), p.get("updated_at")) for p in raw_pipelines[:ACTIVITY_DEPTH])

    def list_runs(
        self,
        full_name: str,
        workflow_id: str | None = None,
        branch: str | None = None,
        status: str | None = None,
        page: int = 1,
        per_page: int = 30,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "per_page": per_page}
        if branch:
            params["ref"] = branch
        if status:
            params["status"] = {"failure": "failed", "success": "success", "running": "running"}.get(status, status)
        data, response = self._client.get_json_with_response(f"{self._base(full_name)}/pipelines", params)
        runs = self._enrich(full_name, data, limit=len(data))
        total = int(response.headers.get("x-total") or 0) or (page - 1) * per_page + len(runs)
        has_more = bool(response.headers.get("x-next-page")) if "x-next-page" in response.headers else len(runs) == per_page
        return {"runs": runs, "total_count": total, "page": page, "has_more": has_more}

    def get_run(self, full_name: str, run_id: str) -> dict[str, Any]:
        base = self._base(full_name)
        detail = self._client.get_json(f"{base}/pipelines/{run_id}")
        commit = self._commit(base, detail.get("sha"))
        raw_jobs = self._client.paginate(f"{base}/pipelines/{run_id}/jobs", {"per_page": 100})
        jobs = sorted((normalize.job(j) for j in raw_jobs), key=lambda j: int(j["id"]))
        return {
            "run": normalize.pipeline(detail, full_name, detail, commit),
            "jobs": jobs,
            "capabilities": capabilities(GITLAB),
        }

    def list_job_attempts(self, full_name: str, run_id: str) -> list[dict[str, Any]]:
        """Jobs du pipeline, y compris ceux relancés (« Retry ») : tentatives numérotées par nom de job."""
        raw_jobs = self._client.paginate(f"{self._base(full_name)}/pipelines/{run_id}/jobs", {"per_page": 100, "include_retried": "true"})
        attempts: dict[str, int] = {}
        jobs = []
        for job in sorted((normalize.job(j) for j in raw_jobs), key=lambda j: int(j["id"])):
            attempts[job["name"]] = attempts.get(job["name"], 0) + 1
            jobs.append({**job, "attempt": attempts[job["name"]]})
        return jobs

    def get_job_log(self, full_name: str, job_id: str) -> dict[str, Any]:
        with self._lock:
            cached = self._logs.get(job_id)
        if cached:
            return cached
        base = self._base(full_name)
        job = normalize.job(self._client.get_json(f"{base}/jobs/{job_id}"))
        if job["state"] == QUEUED and not job["started_at"]:
            return {"available": False}
        text = self._client.get_text(f"{base}/jobs/{job_id}/trace")
        complete = job["state"] not in (RUNNING, QUEUED)
        parsed = {"available": True, "complete": complete, **logs.parse_log(text, failed=job["state"] == FAILURE, collapse_groups=False)}
        if complete:
            with self._lock:
                self._logs[job_id] = parsed
        return parsed

    def get_job_annotations(self, full_name: str, job_id: str) -> list[dict[str, Any]]:
        base = self._base(full_name)
        raw_job = self._client.get_json(f"{base}/jobs/{job_id}")
        annotations: list[dict[str, Any]] = []

        pipeline_id = (raw_job.get("pipeline") or {}).get("id")
        if pipeline_id:
            try:
                report = self._client.get_json(f"{base}/pipelines/{pipeline_id}/test_report")
            except (NotFoundError, ForbiddenError, EasyCIError):
                report = {}
            for suite in report.get("test_suites") or []:
                if suite.get("name") != raw_job.get("name"):
                    continue
                for case in suite.get("test_cases") or []:
                    if case.get("status") not in ("failed", "error") or len(annotations) >= 10:
                        continue
                    output = (case.get("system_output") or "").strip()
                    annotations.append(
                        {
                            "path": case.get("file"),
                            "start_line": None,
                            "end_line": None,
                            "level": "failure",
                            "title": " › ".join(part for part in (case.get("classname"), case.get("name")) if part),
                            "message": output[:600] or tr("Test en échec."),
                        }
                    )

        reason = raw_job.get("failure_reason")
        if reason:
            level = "warning" if raw_job.get("allow_failure") else "failure"
            message = tr(normalize.FAILURE_REASONS[reason]) if reason in normalize.FAILURE_REASONS else reason
            if raw_job.get("allow_failure"):
                message += tr(" Échec autorisé : le pipeline continue.")
            annotations.append({"path": None, "start_line": None, "end_line": None, "level": level, "title": None, "message": message})
        return annotations

    def rerun_run(self, full_name: str, run_id: str, failed_only: bool = False) -> dict[str, str]:
        """Relance les jobs en échec du même pipeline, ou crée un nouveau pipeline sur la même branche."""
        base = self._base(full_name)
        if failed_only:
            retried = self._client.post(f"{base}/pipelines/{run_id}/retry") or {}
            return {"run_id": str(retried.get("id", run_id))}
        detail = self._client.get_json(f"{base}/pipelines/{run_id}")
        created = self._client.post(f"{base}/pipeline", params={"ref": detail["ref"]}) or {}
        return {"run_id": str(created.get("id", run_id))}

    def cancel_run(self, full_name: str, run_id: str) -> None:
        self._client.post(f"{self._base(full_name)}/pipelines/{run_id}/cancel")

    def compare_commits(self, full_name: str, base_sha: str, head_sha: str) -> dict[str, Any]:
        """Commits et fichiers entre deux commits (depuis leur ancêtre commun)."""
        project = self._project(full_name)
        base = self._base(full_name)
        raw = self._client.get_json(f"{base}/repository/compare", {"from": base_sha, "to": head_sha, "straight": "false"})
        commits = sorted(raw.get("commits") or [], key=lambda item: item.get("created_at") or item.get("authored_date") or "", reverse=True)
        behind_by = None
        status = "ahead" if commits else "identical"
        if not commits and base_sha != head_sha:
            # Rien de nouveau côté « head » : l'exécution comparée porte peut-être sur un commit plus ancien.
            reverse = self._client.get_json(f"{base}/repository/compare", {"from": head_sha, "to": base_sha, "straight": "false"})
            behind_by = len(reverse.get("commits") or [])
            status = "behind" if behind_by else "identical"
        files = []
        for diff in raw.get("diffs") or []:
            status_name = "added" if diff.get("new_file") else "removed" if diff.get("deleted_file") else "renamed" if diff.get("renamed_file") else "modified"
            additions, deletions = _count_diff_lines(diff.get("diff"))
            files.append(file_entry(diff.get("new_path") or diff.get("old_path"), status_name, diff.get("old_path"), additions, deletions))
        return commit_range(
            status=status,
            commits=[
                commit_entry(
                    item["id"],
                    item.get("message") or item.get("title"),
                    item.get("author_name"),
                    item.get("created_at") or item.get("authored_date"),
                    item.get("web_url") or f"{project['html_url']}/-/commit/{item['id']}",
                )
                for item in commits
            ],
            files=files,
            ahead_by=len(commits),
            behind_by=behind_by,
            html_url=f"{project['html_url']}/-/compare/{base_sha}...{head_sha}",
        )

    # -- Merge requests & validation officielle ----------------------------

    def find_pull_request(self, full_name: str, branch: str) -> dict[str, Any] | None:
        requests = self._client.get_json(f"{self._base(full_name)}/merge_requests", {"source_branch": branch, "state": "opened", "per_page": 5})
        return _merge_request(requests[0]) if requests else None

    def create_pull_request(self, full_name: str, branch: str, base: str, title: str, body: str, draft: bool = False) -> dict[str, Any]:
        payload = {"source_branch": branch, "target_branch": base, "title": f"Draft: {title}" if draft else title, "description": body, "remove_source_branch": False}
        return _merge_request(self._client.post(f"{self._base(full_name)}/merge_requests", json=payload))

    def lint_ci(self, full_name: str, content: str, ref: str | None = None) -> dict[str, Any]:
        """Validation officielle GitLab (CI Lint) : includes, extends et règles résolus par le serveur."""
        payload: dict[str, Any] = {"content": content, "dry_run": False, "include_jobs": False}
        if ref:
            payload["ref"] = ref
        raw = self._client.post(f"{self._base(full_name)}/ci/lint", json=payload) or {}
        return {"valid": bool(raw.get("valid")), "errors": raw.get("errors") or [], "warnings": raw.get("warnings") or []}

    # -- Fichiers ---------------------------------------------------------

    def get_workflow_file(self, full_name: str, path: str, ref: str | None = None) -> dict[str, Any]:
        project = self._project(full_name)
        ref = ref or project["default_branch"]
        raw = self._client.get_json(f"{self._base(full_name)}/repository/files/{quote(path, safe='')}", {"ref": ref})
        content = base64.b64decode(raw.get("content", "")).decode("utf-8", errors="replace")
        return {
            "path": path,
            "sha": raw.get("blob_id"),
            "html_url": f"{project['html_url']}/-/blob/{ref}/{path}",
            "content": content,
            "summary": summarize_gitlab_ci(content),
        }

    # -- Interne ----------------------------------------------------------

    def _file_exists(self, base: str, path: str, ref: str) -> bool:
        try:
            return self._client.exists(f"{base}/repository/files/{quote(path, safe='')}", {"ref": ref})
        except (ForbiddenError, EasyCIError):
            return False

    def _commit(self, base: str, sha: str | None) -> dict[str, Any] | None:
        if not sha:
            return None
        with self._lock:
            cached = self._commits.get(sha)
        if cached:
            return cached
        try:
            commit = self._client.get_json(f"{base}/repository/commits/{sha}")
        except (NotFoundError, ForbiddenError):
            return None
        with self._lock:
            self._commits[sha] = commit
        return commit

    def _pipeline_detail(self, base: str, pipeline_id: str) -> dict[str, Any] | None:
        with self._lock:
            cached = self._pipelines.get(pipeline_id)
        if cached:
            return cached
        try:
            detail = self._client.get_json(f"{base}/pipelines/{pipeline_id}")
        except (NotFoundError, ForbiddenError):
            return None
        if detail.get("status") in _FINISHED:
            with self._lock:
                self._pipelines[pipeline_id] = detail
        return detail

    def _enrich(self, full_name: str, raw_pipelines: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
        """Complète les pipelines récents (auteur, durée, message de commit) ; les plus anciens restent légers."""
        base = self._base(full_name)

        def enrich(raw: dict[str, Any]) -> dict[str, Any]:
            detail = self._pipeline_detail(base, str(raw["id"]))
            return normalize.pipeline(raw, full_name, detail, self._commit(base, raw.get("sha")))

        head = list(self._pool.map(enrich, raw_pipelines[:limit]))
        tail = [normalize.pipeline(raw, full_name) for raw in raw_pipelines[limit:]]
        return head + tail


_PIPELINES_PARAMS = {"per_page": 30}


def _count_diff_lines(diff: str | None) -> tuple[int | None, int | None]:
    """Lignes ajoutées et supprimées d'un diff unifié (None si GitLab ne l'a pas renvoyé, fichier trop gros)."""
    if not diff:
        return None, None
    lines = diff.split("\n")
    additions = sum(1 for line in lines if line.startswith("+") and not line.startswith("+++"))
    deletions = sum(1 for line in lines if line.startswith("-") and not line.startswith("---"))
    return additions, deletions


def _merge_request(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "number": raw.get("iid"),
        "title": raw.get("title"),
        "url": raw.get("web_url"),
        "state": raw.get("state"),
        "draft": bool(raw.get("draft") or raw.get("work_in_progress")),
        "source_branch": raw.get("source_branch"),
        "target_branch": raw.get("target_branch"),
        "label": "Merge request",
    }
