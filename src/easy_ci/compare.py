"""Comparaison de deux exécutions d'un même workflow : jobs, durées et commits qui les séparent.

Calcul pur à partir des données normalisées des fournisseurs, sans appel réseau : le moteur
(api.py) récupère les exécutions et les commits, ce module choisit la référence et résume l'écart.

Référence proposée par défaut :
- exécution en échec ou annulée → la dernière exécution **réussie** qui la précède ;
- exécution réussie → l'exécution terminée (réussie ou en échec) qui la précède.
"""

from __future__ import annotations

import re
from typing import Any

from easy_ci.providers import time_key
from easy_ci.stats import FAILURE, SUCCESS, job_outcome

ALLOWED_FAILURE = "allowed_failure"

# Un écart de durée n'est signalé qu'au-delà de ces deux seuils (bruit des runners en dessous).
MIN_DURATION_DELTA_S = 30
MIN_DURATION_CHANGE = 0.25

# Commits et fichiers renvoyés au plus (le total reste indiqué).
MAX_COMMITS = 100
MAX_FILES = 300

# Ordre d'affichage : ce qui explique un échec d'abord.
CHANGE_ORDER = ("broken", "still_failing", "fixed", "added", "removed", "changed", "slower", "faster", "unchanged")

_CI_CONFIG = re.compile(r"^(\.github/workflows/[^/]+\.ya?ml|\.github/actions/.+|\.gitlab-ci\.ya?ml|\.gitlab/ci/.+|bitbucket-pipelines\.ya?ml)$")


def pick_baseline(head: dict[str, Any], runs: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Exécution de référence parmi `runs` (dans n'importe quel ordre), antérieure à `head`."""
    wanted = (SUCCESS, FAILURE) if head.get("state") == SUCCESS else (SUCCESS,)
    created = time_key(head.get("created_at"))
    earlier = [
        run
        for run in runs
        if str(run.get("id")) != str(head.get("id")) and run.get("state") in wanted and time_key(run.get("created_at")) < created
    ]
    return max(earlier, key=lambda run: time_key(run.get("created_at")), default=None)


def commit_range(
    *,
    status: str,
    commits: list[dict[str, Any]],
    files: list[dict[str, Any]] | None = None,
    total_commits: int | None = None,
    files_total: int | None = None,
    more_commits: bool = False,
    more_files: bool = False,
    ahead_by: int | None = None,
    behind_by: int | None = None,
    html_url: str | None = None,
) -> dict[str, Any]:
    """Forme commune de l'écart entre deux commits ; `commits` du plus récent au plus ancien.

    Les totaux valent None quand la plateforme ne les donne pas et que la liste est incomplète
    (`more_commits` / `more_files`).
    """
    files = files or []
    if total_commits is None and not more_commits:
        total_commits = len(commits)
    if files_total is None and not more_files:
        files_total = len(files)
    return {
        "status": status,
        "ahead_by": ahead_by,
        "behind_by": behind_by,
        "total_commits": total_commits,
        "commits": commits[:MAX_COMMITS],
        "commits_truncated": more_commits or len(commits) > MAX_COMMITS or (total_commits or 0) > min(len(commits), MAX_COMMITS),
        "files": files[:MAX_FILES],
        "files_total": files_total,
        "files_truncated": more_files or len(files) > MAX_FILES or (files_total or 0) > min(len(files), MAX_FILES),
        "html_url": html_url,
    }


def commit_entry(sha: str, message: str | None, author_name: str | None, date: str | None, html_url: str | None, login: str | None = None, avatar_url: str | None = None) -> dict[str, Any]:
    message = (message or "").strip()
    return {
        "sha": sha,
        "title": message.split("\n", 1)[0],
        "message": message,
        "author": {"name": author_name or login, "login": login, "avatar_url": avatar_url},
        "date": date,
        "html_url": html_url,
    }


def file_entry(path: str | None, status: str, previous_path: str | None = None, additions: int | None = None, deletions: int | None = None) -> dict[str, Any]:
    """`status` : added, removed, modified ou renamed."""
    return {"path": path, "previous_path": previous_path if previous_path != path else None, "status": status, "additions": additions, "deletions": deletions}


def is_ci_config(path: str | None) -> bool:
    return bool(path and _CI_CONFIG.match(path))


def _change_ratio(base: float | None, head: float | None) -> float | None:
    return (head - base) / base if base and head is not None else None


def _duration_change(base_s: int | None, head_s: int | None) -> str | None:
    if base_s is None or head_s is None:
        return None
    delta = head_s - base_s
    ratio = _change_ratio(base_s, head_s)
    if abs(delta) < MIN_DURATION_DELTA_S or ratio is None or abs(ratio) < MIN_DURATION_CHANGE:
        return None
    return "slower" if delta > 0 else "faster"


def _outcome(job: dict[str, Any]) -> str:
    """Comme pour les statistiques, sauf l'échec autorisé (GitLab) : il ne casse pas le pipeline, on le distingue."""
    return ALLOWED_FAILURE if job.get("allow_failure") else job_outcome(job)


def _job_side(job: dict[str, Any]) -> dict[str, Any]:
    failed_step = next((step.get("name") for step in job.get("steps") or [] if step.get("state") == FAILURE), None)
    return {
        "id": job.get("id"),
        "state": job.get("state"),
        "outcome": _outcome(job),
        "allow_failure": bool(job.get("allow_failure")),
        "duration_s": job.get("duration_s"),
        "failed_step": failed_step,
    }


def _by_name(jobs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Jobs indexés par nom ; un nom répété (étapes Bitbucket homonymes) reçoit un suffixe « (2) »."""
    indexed: dict[str, dict[str, Any]] = {}
    for job in jobs:
        name = job.get("name") or "?"
        key, occurrence = name, 1
        while key in indexed:
            occurrence += 1
            key = f"{name} ({occurrence})"
        indexed[key] = job
    return indexed


def compare_jobs(base_jobs: list[dict[str, Any]], head_jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    base, head = _by_name(base_jobs), _by_name(head_jobs)
    names = list(head) + [name for name in base if name not in head]
    rows = []
    for name in names:
        before, after = base.get(name), head.get(name)
        duration_delta = None
        if before is None:
            change = "added"
        elif after is None:
            change = "removed"
        else:
            old, new = _outcome(before), _outcome(after)
            if new == FAILURE and old == FAILURE:
                change = "still_failing"
            elif new == FAILURE:
                change = "broken"
            elif old == FAILURE and new == SUCCESS:
                change = "fixed"
            elif old != new:
                change = "changed"
            else:
                change = _duration_change(before.get("duration_s"), after.get("duration_s")) or "unchanged"
            if before.get("duration_s") is not None and after.get("duration_s") is not None:
                duration_delta = after["duration_s"] - before["duration_s"]
        reference = after or before or {}
        rows.append(
            {
                "name": name,
                "stage": reference.get("stage"),
                "change": change,
                "base": _job_side(before) if before else None,
                "head": _job_side(after) if after else None,
                "duration_delta_s": duration_delta,
                "duration_change": _change_ratio(before.get("duration_s") if before else None, after.get("duration_s") if after else None),
            }
        )
    # Tri stable : l'ordre d'origine des jobs est conservé dans chaque catégorie.
    rows.sort(key=lambda row: CHANGE_ORDER.index(row["change"]))
    return rows


def build_comparison(base: dict[str, Any], head: dict[str, Any], commits: dict[str, Any] | None) -> dict[str, Any]:
    """Résumé de l'écart entre deux exécutions détaillées ({"run", "jobs"})."""
    base_run, head_run = base["run"], head["run"]
    jobs = compare_jobs(base["jobs"], head["jobs"])
    counts = {change: sum(1 for row in jobs if row["change"] == change) for change in CHANGE_ORDER}
    base_duration, head_duration = base_run.get("duration_s"), head_run.get("duration_s")
    if commits is not None:
        commits = {**commits, "files": [{**item, "ci_config": is_ci_config(item.get("path")) or is_ci_config(item.get("previous_path"))} for item in commits.get("files") or []]}
        commits["ci_config_changed"] = any(item["ci_config"] for item in commits["files"])
    return {
        "summary": {
            **counts,
            "same_commit": bool(base_run.get("head_sha")) and base_run.get("head_sha") == head_run.get("head_sha"),
            "same_branch": base_run.get("branch") == head_run.get("branch"),
            "duration_delta_s": head_duration - base_duration if base_duration is not None and head_duration is not None else None,
            "duration_change": _change_ratio(base_duration, head_duration),
        },
        "jobs": jobs,
        "commits": commits,
    }
