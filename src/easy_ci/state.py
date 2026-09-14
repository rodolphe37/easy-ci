"""Normalisation des statuts des fournisseurs en un état unique affichable."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

SUCCESS = "success"
FAILURE = "failure"
RUNNING = "running"
QUEUED = "queued"
CANCELLED = "cancelled"
SKIPPED = "skipped"
ACTION_REQUIRED = "action_required"
NEUTRAL = "neutral"
NONE = "none"

_QUEUED_STATUSES = {"queued", "waiting", "requested", "pending"}
_FAILURE_CONCLUSIONS = {"failure", "timed_out", "startup_failure"}


def run_state(status: str | None, conclusion: str | None) -> str:
    """GitHub Actions : couple (status, conclusion)."""
    if status in _QUEUED_STATUSES:
        return QUEUED
    if status == "in_progress":
        return RUNNING
    if conclusion == "success":
        return SUCCESS
    if conclusion in _FAILURE_CONCLUSIONS:
        return FAILURE
    if conclusion == "cancelled":
        return CANCELLED
    if conclusion == "skipped":
        return SKIPPED
    if conclusion == "action_required":
        return ACTION_REQUIRED
    return NEUTRAL


_GITLAB_STATES = {
    "created": QUEUED,
    "waiting_for_resource": QUEUED,
    "preparing": QUEUED,
    "pending": QUEUED,
    "scheduled": QUEUED,
    "waiting_for_callback": QUEUED,
    "running": RUNNING,
    "canceling": RUNNING,
    "success": SUCCESS,
    "failed": FAILURE,
    "canceled": CANCELLED,
    "skipped": SKIPPED,
    "manual": ACTION_REQUIRED,
}


def gitlab_state(status: str | None, allow_failure: bool = False) -> str:
    """GitLab CI : statut d'un pipeline ou d'un job. Un échec autorisé (allow_failure) n'est pas bloquant."""
    state = _GITLAB_STATES.get(status or "", NEUTRAL)
    if state == FAILURE and allow_failure:
        return NEUTRAL
    return state


_BITBUCKET_RESULTS = {
    "SUCCESSFUL": SUCCESS,
    "FAILED": FAILURE,
    "ERROR": FAILURE,
    "EXPIRED": FAILURE,
    "STOPPED": CANCELLED,
    "NOT_RUN": SKIPPED,
    "SKIPPED": SKIPPED,
}


def bitbucket_state(state: dict[str, Any] | None) -> str:
    """Bitbucket Pipelines : objet « state » ({name, result: {name}, stage: {name}})."""
    state = state or {}
    name = state.get("name")
    if name == "PENDING":
        return QUEUED
    if name == "IN_PROGRESS":
        stage = (state.get("stage") or {}).get("name")
        if stage in ("PAUSED", "HALTED"):
            return ACTION_REQUIRED
        return QUEUED if stage == "PENDING" else RUNNING
    if name == "PAUSED":
        return ACTION_REQUIRED
    if name == "COMPLETED":
        return _BITBUCKET_RESULTS.get((state.get("result") or {}).get("name", ""), NEUTRAL)
    return NEUTRAL


# Ordre de priorité pour résumer plusieurs états en un seul.
_PRIORITY = [RUNNING, QUEUED, FAILURE, ACTION_REQUIRED, SUCCESS, CANCELLED, SKIPPED, NEUTRAL]


def aggregate_state(states: Iterable[str]) -> str:
    present = set(states)
    for state in _PRIORITY:
        if state in present:
            return state
    return NONE
