"""Statistiques des exécutions dans le temps : durées, taux de réussite, jobs instables.

Calcul pur à partir des données normalisées des fournisseurs (exécutions et jobs de chaque
tentative), sans appel réseau : le moteur (api.py) récupère les données, ce module les résume.

Un job est dit **instable** quand :
- il a échoué puis réussi sur le même commit (relance d'un job ou d'un pipeline, sans changement
  de code) — signe le plus fiable d'un test « flaky » ;
- ou il alterne souvent entre succès et échec : au moins 4 changements d'état, soit au moins un
  changement pour 5 exécutions.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

SUCCESS, FAILURE, CANCELLED, SKIPPED = "success", "failure", "cancelled", "skipped"
COMPLETED_RUN_STATES = (SUCCESS, FAILURE, CANCELLED)

MIN_ALTERNATING_FLIPS = 4
MIN_FLIP_RATE = 0.2


def percentile(values: list[float], ratio: float) -> float | None:
    """Percentile par rang le plus proche (0.5 = médiane, 0.9 = 90e percentile)."""
    if not values:
        return None
    ordered = sorted(values)
    if ratio == 0.5 and len(ordered) % 2 == 0:
        middle = len(ordered) // 2
        return (ordered[middle - 1] + ordered[middle]) / 2
    index = min(len(ordered) - 1, max(0, round(ratio * (len(ordered) - 1))))
    return float(ordered[index])


def duration_summary(values: list[float]) -> dict[str, float | None]:
    return {
        "median": percentile(values, 0.5),
        "p90": percentile(values, 0.9),
        "average": sum(values) / len(values) if values else None,
        "min": float(min(values)) if values else None,
        "max": float(max(values)) if values else None,
    }


def job_outcome(job: dict[str, Any]) -> str:
    """Résultat d'un job pour les statistiques. Un échec autorisé (GitLab) reste un échec du job."""
    state = job.get("state")
    if state == SUCCESS:
        return SUCCESS
    if state == FAILURE or job.get("allow_failure"):
        return FAILURE
    if state == CANCELLED:
        return CANCELLED
    return SKIPPED


def _rate(success: int, failure: int) -> float | None:
    return success / (success + failure) if success + failure else None


def _trend(durations: list[float]) -> dict[str, float | None] | None:
    """Médiane de la moitié la plus récente comparée à la plus ancienne (au moins 6 exécutions)."""
    if len(durations) < 6:
        return None
    half = len(durations) // 2
    previous, recent = percentile(durations[:half], 0.5), percentile(durations[-half:], 0.5)
    change = (recent - previous) / previous if previous else None
    return {"previous_median": previous, "recent_median": recent, "change": change}


def compute_stats(runs: list[dict[str, Any]], attempts_by_run: dict[str, list[dict[str, Any]]], workflows: dict[str, str] | None = None) -> dict[str, Any]:
    """Résume les exécutions terminées (dans n'importe quel ordre) et les jobs de leurs tentatives.

    `attempts_by_run` : identifiant d'exécution → jobs de toutes ses tentatives (clé « attempt »).
    `workflows` : identifiant de workflow → nom, pour distinguer des jobs homonymes.
    """
    workflows = workflows or {}
    completed = sorted((r for r in runs if r.get("state") in COMPLETED_RUN_STATES), key=lambda r: r.get("created_at") or "")

    run_points = []
    run_durations: list[float] = []
    counts = {SUCCESS: 0, FAILURE: 0, CANCELLED: 0}
    for run in completed:
        counts[run["state"]] += 1
        if run.get("duration_s") is not None and run["state"] != CANCELLED:
            run_durations.append(float(run["duration_s"]))
        run_points.append(
            {
                "id": run["id"],
                "run_number": run.get("run_number"),
                "state": run["state"],
                "created_at": run.get("created_at"),
                "duration_s": run.get("duration_s"),
                "branch": run.get("branch"),
                "title": run.get("title"),
                "attempt": run.get("run_attempt") or 1,
                "workflow_id": str(run.get("workflow_id")),
                "workflow_name": run.get("name") or workflows.get(str(run.get("workflow_id"))),
            }
        )

    jobs: dict[tuple[str, str], dict[str, Any]] = {}
    for run in completed:
        attempts = attempts_by_run.get(str(run["id"]))
        if not attempts:
            continue
        workflow_id = str(run.get("workflow_id"))
        by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for job in attempts:
            by_name[job.get("name") or "?"].append(job)
        for name, entries in by_name.items():
            entries.sort(key=lambda j: (j.get("attempt") or 1, j.get("started_at") or "", str(j.get("id"))))
            final = entries[-1]
            outcome = job_outcome(final)
            data = jobs.setdefault(
                (workflow_id, name),
                {
                    "name": name,
                    "stage": final.get("stage"),
                    "workflow_id": workflow_id,
                    "workflow_name": run.get("name") or workflows.get(workflow_id),
                    "history": [],
                    "retried_recoveries": 0,
                },
            )
            outcomes = [job_outcome(entry) for entry in entries]
            if outcome == SUCCESS and FAILURE in outcomes:
                data["retried_recoveries"] += 1
            data["history"].append(
                {
                    "run_id": run["id"],
                    "run_number": run.get("run_number"),
                    "created_at": run.get("created_at"),
                    "head_sha": run.get("head_sha"),
                    "outcome": outcome,
                    "allowed_failure": bool(final.get("allow_failure")),
                    "duration_s": final.get("duration_s"),
                    "attempts": len(entries),
                }
            )

    job_stats = [_job_summary(data) for data in jobs.values()]
    job_stats.sort(key=lambda j: (not j["unstable"], -(j["failure"] / j["runs"] if j["runs"] else 0), -(j["duration"]["median"] or 0), j["name"]))

    return {
        "runs_analyzed": len(completed),
        "jobs_analyzed": sum(1 for run in completed if attempts_by_run.get(str(run["id"]))),
        "summary": {
            **counts,
            "success_rate": _rate(counts[SUCCESS], counts[FAILURE]),
            "duration": duration_summary(run_durations),
            "trend": _trend(run_durations),
            "first_run_at": completed[0].get("created_at") if completed else None,
            "last_run_at": completed[-1].get("created_at") if completed else None,
        },
        "runs": run_points,
        "jobs": job_stats,
        "unstable_jobs": sum(1 for job in job_stats if job["unstable"]),
    }


def _job_summary(data: dict[str, Any]) -> dict[str, Any]:
    history = data["history"]
    decided = [entry for entry in history if entry["outcome"] in (SUCCESS, FAILURE)]
    flips = sum(1 for previous, current in zip(decided, decided[1:], strict=False) if previous["outcome"] != current["outcome"])

    # Échec puis succès sur le même commit, sans modification du code entre les deux.
    failed_commits: set[str] = set()
    same_commit_recoveries = 0
    for entry in decided:
        sha = entry.get("head_sha")
        if not sha:
            continue
        if entry["outcome"] == FAILURE:
            failed_commits.add(sha)
        elif sha in failed_commits:
            same_commit_recoveries += 1
            failed_commits.discard(sha)

    reasons = []
    if data["retried_recoveries"] or same_commit_recoveries:
        reasons.append("retried")
    flip_rate = flips / (len(decided) - 1) if len(decided) > 1 else 0.0
    if flips >= MIN_ALTERNATING_FLIPS and flip_rate >= MIN_FLIP_RATE:
        reasons.append("alternating")

    success = sum(1 for entry in history if entry["outcome"] == SUCCESS)
    failure = sum(1 for entry in history if entry["outcome"] == FAILURE)
    durations = [float(entry["duration_s"]) for entry in decided if entry.get("duration_s") is not None]
    return {
        "name": data["name"],
        "stage": data["stage"],
        "workflow_id": data["workflow_id"],
        "workflow_name": data["workflow_name"],
        "runs": len(history),
        "success": success,
        "failure": failure,
        "allowed_failures": sum(1 for entry in history if entry["allowed_failure"]),
        "skipped": sum(1 for entry in history if entry["outcome"] in (SKIPPED, CANCELLED)),
        "success_rate": _rate(success, failure),
        "duration": duration_summary(durations),
        "flips": flips,
        "flip_rate": flip_rate,
        "recoveries": data["retried_recoveries"] + same_commit_recoveries,
        "unstable": bool(reasons),
        "reasons": reasons,
        "history": [{k: entry[k] for k in ("run_id", "run_number", "created_at", "outcome", "duration_s", "attempts")} for entry in history],
    }
