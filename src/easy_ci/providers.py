"""Description des fournisseurs CI/CD et éléments communs à leurs services."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from typing import Any, Protocol

from easy_ci.i18n import N_, tr
from easy_ci.state import NONE, aggregate_state

GITHUB = "github"
GITLAB = "gitlab"
BITBUCKET = "bitbucket"
PROVIDERS = (GITHUB, GITLAB, BITBUCKET)

HISTORY_SIZE = 12
RECENT_RUNS = 8

# Ce que chaque fournisseur permet : l'interface adapte ses boutons et ses explications.
PROVIDER_INFO: dict[str, dict[str, Any]] = {
    GITHUB: {
        "id": GITHUB,
        "label": "GitHub",
        "ci_label": "GitHub Actions",
        "workflow_label": "Workflows",
        "run_label": N_("Exécution"),
        "config_hint": ".github/workflows/*.yml",
        "default_host": "https://github.com",
        "token_url": "https://github.com/settings/tokens/new?scopes=repo,workflow,read:org&description=Easy%20CI",
        "capabilities": {
            "rerun_failed": True,
            "rerun_all": True,
            "rerun_all_label": N_("Relancer tous les jobs"),
            "rerun_all_description": N_("Nouvelle tentative de toute l'exécution"),
            "cancel": True,
            "live_logs": False,
            "annotations": True,
            "steps": True,
        },
    },
    GITLAB: {
        "id": GITLAB,
        "label": "GitLab",
        "ci_label": "GitLab CI/CD",
        "workflow_label": "Pipelines",
        "run_label": "Pipeline",
        "config_hint": ".gitlab-ci.yml",
        "default_host": "https://gitlab.com",
        "token_url": "https://gitlab.com/-/user_settings/personal_access_tokens?name=Easy%20CI&scopes=api,read_user",
        "capabilities": {
            "rerun_failed": True,
            "rerun_all": True,
            "rerun_all_label": N_("Lancer un nouveau pipeline"),
            "rerun_all_description": N_("Nouveau pipeline sur la même branche (dernier commit)"),
            "cancel": True,
            "live_logs": True,
            "annotations": True,
            "steps": False,
        },
    },
    BITBUCKET: {
        "id": BITBUCKET,
        "label": "Bitbucket",
        "ci_label": "Bitbucket Pipelines",
        "workflow_label": "Pipelines",
        "run_label": "Pipeline",
        "config_hint": "bitbucket-pipelines.yml",
        "default_host": "https://bitbucket.org",
        "token_url": "https://id.atlassian.com/manage-profile/security/api-tokens",
        "capabilities": {
            "rerun_failed": False,
            "rerun_all": True,
            "rerun_all_label": N_("Lancer un nouveau pipeline"),
            "rerun_all_description": N_("Nouveau pipeline sur la même branche (dernier commit)"),
            "cancel": True,
            "live_logs": True,
            "annotations": False,
            "steps": False,
        },
    },
}


class ProviderService(Protocol):
    """Contrat commun des services GitHub, GitLab, Bitbucket (et du mode démo)."""

    provider: str

    def close(self) -> None: ...
    def get_user(self) -> dict[str, Any]: ...
    def rate_limit(self) -> dict[str, int] | None: ...
    def list_repositories(self) -> list[dict[str, Any]]: ...
    def get_repository(self, full_name: str) -> dict[str, Any]: ...
    def scan_repository(self, full_name: str) -> dict[str, Any]: ...
    def list_runs(self, full_name: str, workflow_id: str | None = None, branch: str | None = None, status: str | None = None, page: int = 1) -> dict[str, Any]: ...
    def get_run(self, full_name: str, run_id: str) -> dict[str, Any]: ...
    def get_job_log(self, full_name: str, job_id: str) -> dict[str, Any]: ...
    def get_job_annotations(self, full_name: str, job_id: str) -> list[dict[str, Any]]: ...
    def rerun_run(self, full_name: str, run_id: str, failed_only: bool = False) -> None: ...
    def cancel_run(self, full_name: str, run_id: str) -> None: ...
    def get_workflow_file(self, full_name: str, path: str, ref: str | None = None) -> dict[str, Any]: ...


def repo_key(provider: str, full_name: str) -> str:
    return f"{provider}:{full_name}"


def split_repo_key(key: str) -> tuple[str, str]:
    """« gitlab:groupe/projet » → (gitlab, groupe/projet). Sans préfixe : GitHub (anciennes préférences)."""
    provider, sep, full_name = key.partition(":")
    if sep and provider in PROVIDERS:
        return provider, full_name
    return GITHUB, key


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def duration_between(start: str | None, end: str | None) -> int | None:
    started, ended = parse_time(start), parse_time(end)
    if not started or not ended:
        return None
    return max(0, int((ended - started).total_seconds()))


def empty_scan(full_name: str) -> dict[str, Any]:
    return {"full_name": full_name, "has_ci": False, "state": NONE, "workflows": [], "recent_runs": [], "last_run": None, "scanned_at": now_iso()}


def build_scan(full_name: str, workflows: list[dict[str, Any]], runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Assemble le résultat d'un scan à partir des workflows et des exécutions récentes (plus récentes d'abord)."""
    runs_by_workflow: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for run in runs:
        runs_by_workflow[str(run["workflow_id"])].append(run)

    enriched = []
    for wf in workflows:
        wf_runs = runs_by_workflow.get(str(wf["id"]), [])
        enriched.append(
            {
                **wf,
                "latest_run": wf_runs[0] if wf_runs else None,
                "history": [
                    {"id": r["id"], "run_number": r["run_number"], "state": r["state"], "created_at": r["created_at"]}
                    for r in reversed(wf_runs[:HISTORY_SIZE])
                ],
            }
        )

    active_states = [wf["latest_run"]["state"] for wf in enriched if wf["latest_run"] and wf["state"] == "active"]
    return {
        "full_name": full_name,
        "has_ci": True,
        "state": aggregate_state(active_states),
        "workflows": enriched,
        "recent_runs": runs[:RECENT_RUNS],
        "last_run": runs[0] if runs else None,
        "scanned_at": now_iso(),
    }


_TRANSLATED_CAPABILITIES = ("rerun_all_label", "rerun_all_description")


def capabilities(provider: str) -> dict[str, Any]:
    """Capacités d'un fournisseur, libellés traduits dans la langue courante."""
    caps = dict(PROVIDER_INFO[provider]["capabilities"])
    return {key: tr(value) if key in _TRANSLATED_CAPABILITIES else value for key, value in caps.items()}


def provider_info() -> dict[str, dict[str, Any]]:
    return {provider: {**info, "run_label": tr(info["run_label"]), "capabilities": capabilities(provider)} for provider, info in PROVIDER_INFO.items()}
