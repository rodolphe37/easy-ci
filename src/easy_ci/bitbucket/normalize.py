"""Conversion des objets de l'API Bitbucket Cloud 2.0 vers les formes communes de l'interface."""

from __future__ import annotations

from typing import Any

from easy_ci.providers import BITBUCKET, repo_key
from easy_ci.state import bitbucket_state

WORKFLOW_ID = "bitbucket-pipelines"
CONFIG_PATH = "bitbucket-pipelines.yml"
WEB_URL = "https://bitbucket.org"

_TRIGGER_EVENTS = {"PUSH": "push", "MANUAL": "manual", "SCHEDULE": "schedule"}


def _avatar(raw: dict[str, Any]) -> str | None:
    return ((raw.get("links") or {}).get("avatar") or {}).get("href")


def user(raw: dict[str, Any]) -> dict[str, Any]:
    login = raw.get("username") or raw.get("nickname") or raw.get("account_id") or "bitbucket"
    return {
        "login": login,
        "name": raw.get("display_name") or login,
        "avatar_url": _avatar(raw),
        "html_url": ((raw.get("links") or {}).get("html") or {}).get("href"),
    }


def repository(raw: dict[str, Any]) -> dict[str, Any]:
    full_name = raw["full_name"]
    workspace, _, slug = full_name.partition("/")
    return {
        "id": str(raw.get("uuid") or full_name),
        "provider": BITBUCKET,
        "key": repo_key(BITBUCKET, full_name),
        "full_name": full_name,
        "owner": (raw.get("workspace") or {}).get("slug") or workspace,
        "name": raw.get("slug") or slug,
        "description": raw.get("description") or None,
        "private": raw.get("is_private", True),
        "fork": bool(raw.get("parent")),
        "archived": False,
        "language": raw.get("language") or None,
        "default_branch": (raw.get("mainbranch") or {}).get("name") or "main",
        "html_url": ((raw.get("links") or {}).get("html") or {}).get("href") or f"{WEB_URL}/{full_name}",
        "pushed_at": raw.get("updated_on"),
        "ci_config_path": CONFIG_PATH,
    }


def pipeline(raw: dict[str, Any], full_name: str, commit: dict[str, Any] | None = None) -> dict[str, Any]:
    target = raw.get("target") or {}
    selector = target.get("selector") or {}
    state = raw.get("state") or {}
    message = ((commit or {}).get("message") or "").strip()
    creator = raw.get("creator") or {}
    number = raw.get("build_number")

    if target.get("type") == "pipeline_pullrequest_target":
        event = "pull_request"
        branch = (target.get("source") or target.get("ref_name"))
    else:
        event = _TRIGGER_EVENTS.get((raw.get("trigger") or {}).get("name", ""), "push")
        branch = target.get("ref_name")
    name = f"{selector.get('type')}: {selector.get('pattern')}" if selector.get("type") == "custom" else "Pipeline"
    if selector.get("type") == "custom":
        event = "manual"

    completed = state.get("name") == "COMPLETED"
    return {
        "id": raw["uuid"],
        "name": name,
        "title": message.split("\n", 1)[0] or f"Pipeline #{number} · {branch}",
        "commit_message": message,
        "workflow_id": WORKFLOW_ID,
        "run_number": number,
        "run_attempt": 1,
        "event": event,
        "status": state.get("name"),
        "conclusion": (state.get("result") or {}).get("name"),
        "state": bitbucket_state(state),
        "branch": branch,
        "head_sha": (target.get("commit") or {}).get("hash"),
        "actor": {"login": creator.get("nickname") or creator.get("display_name"), "avatar_url": _avatar(creator)} if creator else None,
        "created_at": raw.get("created_on"),
        "started_at": raw.get("created_on"),
        "updated_at": raw.get("completed_on") or raw.get("created_on"),
        "duration_s": raw.get("duration_in_seconds") if completed else None,
        "html_url": f"{WEB_URL}/{full_name}/pipelines/results/{number}",
        "repository": full_name,
    }


def step(raw: dict[str, Any], full_name: str, pipeline_raw: dict[str, Any]) -> dict[str, Any]:
    state = raw.get("state") or {}
    image = raw.get("image") or {}
    number = pipeline_raw.get("build_number")
    completed = state.get("name") == "COMPLETED"
    return {
        # Le log d'un step exige aussi l'identifiant du pipeline : on les combine.
        "id": f"{pipeline_raw['uuid']}:{raw['uuid']}",
        "name": raw.get("name") or "Step",
        "stage": None,
        "allow_failure": False,
        "status": state.get("name"),
        "conclusion": (state.get("result") or {}).get("name"),
        "state": bitbucket_state(state),
        "started_at": raw.get("started_on"),
        "completed_at": raw.get("completed_on"),
        "duration_s": raw.get("duration_in_seconds") if completed else None,
        "runner_name": None,
        "labels": [image["name"]] if image.get("name") else [],
        "html_url": f"{WEB_URL}/{full_name}/pipelines/results/{number}/steps/{raw['uuid']}",
        "steps": [],
    }
