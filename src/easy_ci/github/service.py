"""Opérations GitHub Actions de haut niveau utilisées par l'interface."""

from __future__ import annotations

import base64
import threading
from typing import Any

from easy_ci import logs
from easy_ci.errors import NotFoundError
from easy_ci.github import normalize
from easy_ci.github.client import GitHubClient
from easy_ci.providers import GITHUB, PROVIDER_INFO, build_scan, empty_scan
from easy_ci.workflow_yaml import summarize_workflow


class GitHubService:
    provider = GITHUB

    def __init__(self, client: GitHubClient) -> None:
        self._client = client
        self._log_cache: dict[str, dict[str, Any]] = {}
        self._log_lock = threading.Lock()

    def close(self) -> None:
        self._client.close()

    # -- Compte -----------------------------------------------------------

    def get_user(self) -> dict[str, Any]:
        return normalize.user(self._client.get_json("/user"))

    def rate_limit(self) -> dict[str, int] | None:
        return self._client.rate_limit

    # -- Dépôts -----------------------------------------------------------

    def list_repositories(self) -> list[dict[str, Any]]:
        raw = self._client.paginate(
            "/user/repos",
            {"per_page": 100, "sort": "pushed", "affiliation": "owner,collaborator,organization_member"},
        )
        return [normalize.repository(r) for r in raw]

    def get_repository(self, full_name: str) -> dict[str, Any]:
        return normalize.repository(self._client.get_json(f"/repos/{full_name}"))

    def scan_repository(self, full_name: str) -> dict[str, Any]:
        """Détecte les workflows d'un dépôt et calcule l'état de chacun."""
        try:
            raw_workflows = self._client.get_json(f"/repos/{full_name}/actions/workflows", {"per_page": 100})
        except NotFoundError:
            raw_workflows = {"workflows": []}
        workflows = [normalize.workflow(w) for w in raw_workflows.get("workflows", [])]
        if not workflows:
            return empty_scan(full_name)

        raw_runs = self._client.get_json(f"/repos/{full_name}/actions/runs", {"per_page": 100})
        runs = [normalize.run(r) for r in raw_runs.get("workflow_runs", [])]
        return build_scan(full_name, workflows, runs)

    # -- Exécutions -------------------------------------------------------

    def list_runs(
        self,
        full_name: str,
        workflow_id: str | None = None,
        branch: str | None = None,
        status: str | None = None,
        page: int = 1,
        per_page: int = 30,
    ) -> dict[str, Any]:
        url = f"/repos/{full_name}/actions/workflows/{workflow_id}/runs" if workflow_id else f"/repos/{full_name}/actions/runs"
        params: dict[str, Any] = {"page": page, "per_page": per_page}
        if branch:
            params["branch"] = branch
        if status:
            params["status"] = {"running": "in_progress"}.get(status, status)
        data = self._client.get_json(url, params)
        runs = [normalize.run(r) for r in data.get("workflow_runs", [])]
        total = data.get("total_count", len(runs))
        return {"runs": runs, "total_count": total, "page": page, "has_more": page * per_page < total}

    def get_run(self, full_name: str, run_id: str) -> dict[str, Any]:
        run = normalize.run(self._client.get_json(f"/repos/{full_name}/actions/runs/{run_id}"))
        raw_jobs = self._client.paginate(f"/repos/{full_name}/actions/runs/{run_id}/jobs", {"per_page": 100, "filter": "latest"}, key="jobs")
        return {"run": run, "jobs": [normalize.job(j) for j in raw_jobs], "capabilities": PROVIDER_INFO[GITHUB]["capabilities"]}

    def get_job_log(self, full_name: str, job_id: str) -> dict[str, Any]:
        with self._log_lock:
            cached = self._log_cache.get(job_id)
        if cached:
            return cached
        try:
            text = self._client.get_text(f"/repos/{full_name}/actions/jobs/{job_id}/logs")
        except NotFoundError:
            # GitHub ne publie le log d'un job qu'une fois celui-ci terminé.
            return {"available": False}
        parsed = {"available": True, "complete": True, **logs.parse_log(text)}
        with self._log_lock:
            self._log_cache[job_id] = parsed
        return parsed

    def get_job_annotations(self, full_name: str, job_id: str) -> list[dict[str, Any]]:
        try:
            raw = self._client.get_json(f"/repos/{full_name}/check-runs/{job_id}/annotations", {"per_page": 50})
        except NotFoundError:
            return []
        return [normalize.annotation(a) for a in raw]

    def rerun_run(self, full_name: str, run_id: str, failed_only: bool = False) -> dict[str, str]:
        """GitHub crée une nouvelle tentative de la même exécution."""
        suffix = "rerun-failed-jobs" if failed_only else "rerun"
        self._client.post(f"/repos/{full_name}/actions/runs/{run_id}/{suffix}")
        return {"run_id": run_id}

    def cancel_run(self, full_name: str, run_id: str) -> None:
        self._client.post(f"/repos/{full_name}/actions/runs/{run_id}/cancel")

    # -- Fichiers ---------------------------------------------------------

    def get_workflow_file(self, full_name: str, path: str, ref: str | None = None) -> dict[str, Any]:
        params = {"ref": ref} if ref else None
        raw = self._client.get_json(f"/repos/{full_name}/contents/{path}", params)
        content = base64.b64decode(raw.get("content", "")).decode("utf-8", errors="replace")
        return {
            "path": path,
            "sha": raw.get("sha"),
            "html_url": raw.get("html_url"),
            "content": content,
            "summary": summarize_workflow(content),
        }
