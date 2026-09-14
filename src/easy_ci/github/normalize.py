"""Conversion des objets bruts de l'API GitHub vers les formes utilisées par l'interface."""

from __future__ import annotations

from typing import Any

from easy_ci.providers import GITHUB, duration_between as _duration, repo_key
from easy_ci.state import run_state


def user(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "login": raw["login"],
        "name": raw.get("name") or raw["login"],
        "avatar_url": raw.get("avatar_url"),
        "html_url": raw.get("html_url"),
    }


def repository(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(raw["id"]),
        "provider": GITHUB,
        "key": repo_key(GITHUB, raw["full_name"]),
        "full_name": raw["full_name"],
        "owner": raw["owner"]["login"],
        "name": raw["name"],
        "description": raw.get("description"),
        "private": raw.get("private", False),
        "fork": raw.get("fork", False),
        "archived": raw.get("archived", False),
        "language": raw.get("language"),
        "default_branch": raw.get("default_branch", "main"),
        "html_url": raw.get("html_url"),
        "pushed_at": raw.get("pushed_at"),
        "ci_config_path": None,
    }


def workflow(raw: dict[str, Any]) -> dict[str, Any]:
    path = raw.get("path", "")
    return {
        "id": str(raw["id"]),
        "name": raw.get("name") or path,
        "path": path,
        "state": raw.get("state", "active"),
        "html_url": raw.get("html_url"),
        # Workflows générés par GitHub (Pages, Dependabot, Copilot…) : pas de fichier YAML.
        "dynamic": not path.startswith(".github/workflows/"),
    }


def run(raw: dict[str, Any]) -> dict[str, Any]:
    status, conclusion = raw.get("status"), raw.get("conclusion")
    started_at = raw.get("run_started_at") or raw.get("created_at")
    completed = status == "completed"
    head_commit = raw.get("head_commit") or {}
    actor = raw.get("triggering_actor") or raw.get("actor") or {}
    message = (head_commit.get("message") or raw.get("display_title") or "").strip()
    return {
        "id": str(raw["id"]),
        "name": raw.get("name"),
        "title": raw.get("display_title") or message.split("\n", 1)[0],
        "commit_message": message,
        "workflow_id": str(raw.get("workflow_id")),
        "run_number": raw.get("run_number"),
        "run_attempt": raw.get("run_attempt", 1),
        "event": raw.get("event"),
        "status": status,
        "conclusion": conclusion,
        "state": run_state(status, conclusion),
        "branch": raw.get("head_branch"),
        "head_sha": raw.get("head_sha"),
        "actor": {"login": actor.get("login"), "avatar_url": actor.get("avatar_url")} if actor else None,
        "created_at": raw.get("created_at"),
        "started_at": started_at,
        "updated_at": raw.get("updated_at"),
        "duration_s": _duration(started_at, raw.get("updated_at")) if completed else None,
        "html_url": raw.get("html_url"),
        "repository": (raw.get("repository") or {}).get("full_name"),
    }


def step(raw: dict[str, Any]) -> dict[str, Any]:
    status, conclusion = raw.get("status"), raw.get("conclusion")
    return {
        "number": raw.get("number"),
        "name": raw.get("name"),
        "status": status,
        "conclusion": conclusion,
        "state": run_state(status, conclusion),
        "started_at": raw.get("started_at"),
        "completed_at": raw.get("completed_at"),
        "duration_s": _duration(raw.get("started_at"), raw.get("completed_at")),
    }


def job(raw: dict[str, Any]) -> dict[str, Any]:
    status, conclusion = raw.get("status"), raw.get("conclusion")
    return {
        "id": str(raw["id"]),
        "name": raw.get("name"),
        "stage": None,
        "allow_failure": False,
        "status": status,
        "conclusion": conclusion,
        "state": run_state(status, conclusion),
        "started_at": raw.get("started_at"),
        "completed_at": raw.get("completed_at"),
        "duration_s": _duration(raw.get("started_at"), raw.get("completed_at")),
        "runner_name": raw.get("runner_name"),
        "labels": raw.get("labels") or [],
        "html_url": raw.get("html_url"),
        "steps": [step(s) for s in raw.get("steps") or []],
    }


def annotation(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": raw.get("path"),
        "start_line": raw.get("start_line"),
        "end_line": raw.get("end_line"),
        "level": raw.get("annotation_level", "failure"),
        "title": raw.get("title"),
        "message": raw.get("message", ""),
    }
