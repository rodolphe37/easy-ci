"""Conversion des objets de l'API GitLab v4 vers les formes communes de l'interface."""

from __future__ import annotations

from typing import Any

from easy_ci.providers import GITLAB, repo_key
from easy_ci.state import gitlab_state

WORKFLOW_ID = "gitlab-ci"

SOURCE_EVENTS = {
    "push": "push",
    "merge_request_event": "merge_request",
    "external_pull_request_event": "pull_request",
    "schedule": "schedule",
    "web": "manual",
    "api": "api",
    "trigger": "trigger",
    "pipeline": "pipeline",
    "parent_pipeline": "pipeline",
    "chat": "manual",
}

FAILURE_REASONS = {
    "script_failure": "Le script du job s'est terminé en erreur (code de sortie non nul).",
    "runner_system_failure": "Défaillance du runner pendant l'exécution.",
    "stuck_or_timeout_failure": "Job bloqué : aucun runner disponible ou délai d'attente dépassé.",
    "job_execution_timeout": "Durée maximale d'exécution du job dépassée.",
    "missing_dependency_failure": "Un artefact attendu d'un job précédent est introuvable ou a expiré.",
    "runner_unsupported": "Le runner ne prend pas en charge une fonctionnalité demandée par le job.",
    "stale_schedule": "Pipeline planifié trop ancien, non exécuté.",
    "archived_failure": "Le job ne peut plus être exécuté : il est archivé.",
    "unmet_prerequisites": "Prérequis non satisfaits (par exemple l'environnement de déploiement).",
    "scheduler_failure": "Le planificateur n'a pas pu attribuer le job à un runner.",
    "data_integrity_failure": "Erreur d'intégrité des données côté GitLab.",
    "api_failure": "Erreur de l'API GitLab pendant l'exécution.",
    "forward_deployment_failure": "Déploiement bloqué : un déploiement plus récent existe déjà.",
    "protected_environment_failure": "Environnement protégé : autorisation de déploiement requise.",
    "insufficient_bridge_permissions": "Permissions insuffisantes pour déclencher le pipeline aval.",
    "downstream_bridge_project_not_found": "Projet du pipeline aval introuvable.",
    "reached_max_descendant_pipelines_depth": "Profondeur maximale de pipelines imbriqués atteinte.",
    "user_blocked": "L'utilisateur qui a déclenché le job est bloqué.",
    "ci_quota_exceeded": "Quota de minutes CI épuisé.",
    "no_matching_runner": "Aucun runner ne correspond aux tags du job.",
    "trace_size_exceeded": "Le log du job dépasse la taille maximale autorisée.",
    "builds_disabled": "L'intégration continue est désactivée pour ce projet.",
    "unknown_failure": "Échec pour une raison inconnue.",
}


def user(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "login": raw["username"],
        "name": raw.get("name") or raw["username"],
        "avatar_url": raw.get("avatar_url"),
        "html_url": raw.get("web_url"),
    }


def repository(raw: dict[str, Any]) -> dict[str, Any]:
    full_name = raw["path_with_namespace"]
    namespace = raw.get("namespace") or {}
    return {
        "id": str(raw["id"]),
        "provider": GITLAB,
        "key": repo_key(GITLAB, full_name),
        "full_name": full_name,
        "owner": namespace.get("full_path") or full_name.rsplit("/", 1)[0],
        "name": raw.get("path") or raw.get("name"),
        "description": raw.get("description"),
        "private": raw.get("visibility", "private") != "public",
        "fork": bool(raw.get("forked_from_project")),
        "archived": raw.get("archived", False),
        "language": None,
        "default_branch": raw.get("default_branch") or "main",
        "html_url": raw.get("web_url"),
        "pushed_at": raw.get("last_activity_at"),
        "ci_config_path": raw.get("ci_config_path") or ".gitlab-ci.yml",
    }


def pipeline(raw: dict[str, Any], full_name: str, detail: dict[str, Any] | None = None, commit: dict[str, Any] | None = None) -> dict[str, Any]:
    detail = detail or {}
    status = detail.get("status") or raw.get("status")
    message = ((commit or {}).get("message") or "").strip()
    title = (commit or {}).get("title") or message.split("\n", 1)[0]
    author = detail.get("user") or raw.get("user") or {}
    finished = detail.get("finished_at")
    duration = detail.get("duration")
    iid = raw.get("iid") or detail.get("iid")
    ref = raw.get("ref") or detail.get("ref")
    return {
        "id": str(raw["id"]),
        "name": detail.get("name") or raw.get("name") or "Pipeline",
        "title": title or f"Pipeline #{iid} · {ref}",
        "commit_message": message,
        "workflow_id": WORKFLOW_ID,
        "run_number": iid,
        "run_attempt": 1,
        "event": SOURCE_EVENTS.get(raw.get("source") or detail.get("source") or "", raw.get("source") or "push"),
        "status": status,
        "conclusion": None,
        "state": gitlab_state(status),
        "branch": ref,
        "head_sha": raw.get("sha") or detail.get("sha"),
        "actor": {"login": author.get("username"), "avatar_url": author.get("avatar_url")} if author else None,
        "created_at": raw.get("created_at") or detail.get("created_at"),
        "started_at": detail.get("started_at") or raw.get("created_at"),
        "updated_at": detail.get("updated_at") or raw.get("updated_at"),
        "duration_s": int(duration) if duration is not None and finished else None,
        "html_url": raw.get("web_url") or detail.get("web_url"),
        "repository": full_name,
    }


def job(raw: dict[str, Any]) -> dict[str, Any]:
    status = raw.get("status")
    allow_failure = bool(raw.get("allow_failure"))
    duration = raw.get("duration")
    runner = raw.get("runner") or {}
    return {
        "id": str(raw["id"]),
        "name": raw.get("name"),
        "stage": raw.get("stage"),
        "allow_failure": allow_failure and status == "failed",
        "status": status,
        "conclusion": raw.get("failure_reason"),
        "state": gitlab_state(status, allow_failure),
        "started_at": raw.get("started_at"),
        "completed_at": raw.get("finished_at"),
        "duration_s": int(duration) if duration is not None and raw.get("finished_at") else None,
        "runner_name": runner.get("description"),
        "labels": raw.get("tag_list") or [],
        "html_url": raw.get("web_url"),
        "steps": [],
    }
