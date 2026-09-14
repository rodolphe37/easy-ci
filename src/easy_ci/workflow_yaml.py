"""Lecture des fichiers de configuration CI pour en afficher un résumé.

- GitHub Actions : `.github/workflows/*.yml`
- GitLab CI : `.gitlab-ci.yml`
- Bitbucket Pipelines : `bitbucket-pipelines.yml`

Le résumé a la même forme pour les trois : déclencheurs, stages, jobs (avec dépendances) et inclusions.
"""

from __future__ import annotations

import re
from typing import Any

import yaml

from easy_ci.i18n import tr


class _CiLoader(yaml.SafeLoader):
    """Chargeur sûr qui tolère les balises propres à GitLab (`!reference [...]`)."""


def _construct_unknown(loader: yaml.SafeLoader, tag_suffix: str, node: yaml.Node) -> Any:
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node)
    return loader.construct_scalar(node)


_CiLoader.add_multi_constructor("!", _construct_unknown)


def _load(content: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Renvoie (document, erreur)."""
    try:
        document = yaml.load(content, Loader=_CiLoader)  # noqa: S506 — chargeur dérivé de SafeLoader
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        return None, _invalid(str(getattr(exc, "problem", None) or exc), mark.line + 1 if mark else None)
    if not isinstance(document, dict):
        return None, _invalid(tr("Le fichier ne contient pas de configuration CI."), None)
    return document, None


def _invalid(message: str, line: int | None) -> dict[str, Any]:
    return {"valid": False, "error": message, "error_line": line, "name": None, "triggers": [], "stages": [], "jobs": [], "includes": []}


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def summarize(provider: str, content: str) -> dict[str, Any]:
    if provider == "gitlab":
        return summarize_gitlab_ci(content)
    if provider == "bitbucket":
        return summarize_bitbucket_pipelines(content)
    return summarize_workflow(content)


# ---------------------------------------------------------------------------
# GitHub Actions
# ---------------------------------------------------------------------------


def summarize_workflow(content: str) -> dict[str, Any]:
    document, error = _load(content)
    if error:
        return error
    assert document is not None
    # YAML 1.1 interprète la clé `on` comme le booléen True.
    raw_triggers = document.get("on", document.get(True))
    return {
        "valid": True,
        "error": None,
        "error_line": None,
        "name": document.get("name"),
        "triggers": _github_triggers(raw_triggers),
        "stages": [],
        "jobs": _github_jobs(document.get("jobs")),
        "includes": [],
    }


def _github_triggers(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, str):
        return [{"event": raw, "details": []}]
    if isinstance(raw, list):
        return [{"event": str(event), "details": []} for event in raw]
    if not isinstance(raw, dict):
        return []
    triggers = []
    for event, config in raw.items():
        details: list[str] = []
        if isinstance(config, dict):
            for key in ("branches", "tags", "paths", "types"):
                values = config.get(key)
                if values:
                    details.extend(f"{key}: {v}" for v in _as_list(values))
        elif isinstance(config, list) and event == "schedule":
            details = [f"cron: {item.get('cron')}" for item in config if isinstance(item, dict)]
        triggers.append({"event": str(event), "details": details})
    return triggers


def _github_jobs(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, dict):
        return []
    jobs = []
    for job_id, config in raw.items():
        config = config if isinstance(config, dict) else {}
        runs_on = config.get("runs-on")
        strategy = config.get("strategy")
        jobs.append(
            {
                "id": str(job_id),
                "name": config.get("name") or str(job_id),
                "stage": None,
                "runs_on": ", ".join(map(str, runs_on)) if isinstance(runs_on, list) else runs_on,
                "needs": [str(n) for n in _as_list(config.get("needs"))],
                "steps": len(config.get("steps") or []),
                "uses": config.get("uses"),
                "matrix": bool(strategy.get("matrix")) if isinstance(strategy, dict) else False,
            }
        )
    return jobs


# ---------------------------------------------------------------------------
# GitLab CI
# ---------------------------------------------------------------------------

_GITLAB_RESERVED = {"default", "include", "stages", "variables", "workflow", "image", "services", "cache", "before_script", "after_script", "spec"}
_GITLAB_DEFAULT_STAGES = [".pre", "build", "test", "deploy", ".post"]
_PIPELINE_SOURCE_RE = re.compile(r"\$CI_PIPELINE_SOURCE\s*==\s*['\"](\w+)['\"]")
_GITLAB_SOURCE_EVENTS = {
    "push": "push",
    "merge_request_event": "merge_request",
    "schedule": "schedule",
    "web": "manual",
    "api": "api",
    "trigger": "trigger",
    "pipeline": "pipeline",
    "parent_pipeline": "pipeline",
}
_GITLAB_ONLY_EVENTS = {"merge_requests": "merge_request", "schedules": "schedule", "tags": "tag", "web": "manual", "api": "api", "triggers": "trigger", "pushes": "push", "branches": "push"}


def summarize_gitlab_ci(content: str) -> dict[str, Any]:
    document, error = _load(content)
    if error:
        return error
    assert document is not None

    jobs = []
    for key, config in document.items():
        if not isinstance(key, str) or key in _GITLAB_RESERVED or key.startswith(".") or not isinstance(config, dict):
            continue
        if not any(field in config for field in ("script", "trigger", "extends", "stage", "run")):
            continue
        image = config.get("image")
        image_name = image.get("name") if isinstance(image, dict) else image
        tags = _as_list(config.get("tags"))
        needs = [n.get("job") if isinstance(n, dict) else n for n in _as_list(config.get("needs"))]
        trigger = config.get("trigger")
        parallel = config.get("parallel")
        jobs.append(
            {
                "id": key,
                "name": key,
                "stage": str(config.get("stage") or "test"),
                "runs_on": image_name or (", ".join(map(str, tags)) if tags else None),
                "needs": [str(n) for n in needs if n],
                "steps": len(_as_list(config.get("script"))),
                "uses": (trigger if isinstance(trigger, str) else (trigger or {}).get("project") or (trigger or {}).get("include")) if trigger else None,
                "matrix": isinstance(parallel, dict) and "matrix" in parallel,
            }
        )

    declared = [str(s) for s in _as_list(document.get("stages"))] or _GITLAB_DEFAULT_STAGES
    used = {job["stage"] for job in jobs}
    stages = [stage for stage in declared if stage in used] + sorted(used - set(declared))

    includes = []
    for item in _as_list(document.get("include")):
        if isinstance(item, str):
            includes.append(item)
        elif isinstance(item, dict):
            value = item.get("local") or item.get("file") or item.get("template") or item.get("remote") or item.get("component") or item.get("project")
            if isinstance(value, list):
                includes.extend(map(str, value))
            elif value:
                includes.append(str(value))

    workflow = document.get("workflow") if isinstance(document.get("workflow"), dict) else {}
    return {
        "valid": True,
        "error": None,
        "error_line": None,
        "name": workflow.get("name"),
        "triggers": _gitlab_triggers(document, workflow),
        "stages": stages,
        "jobs": jobs,
        "includes": includes,
    }


def _gitlab_triggers(document: dict[str, Any], workflow: dict[str, Any]) -> list[dict[str, Any]]:
    events: dict[str, list[str]] = {}

    def add(event: str, detail: str | None = None) -> None:
        details = events.setdefault(event, [])
        if detail and detail not in details:
            details.append(detail)

    def from_rules(rules: Any) -> None:
        for rule in _as_list(rules):
            condition = rule.get("if", "") if isinstance(rule, dict) else ""
            if not isinstance(condition, str):
                continue
            if rule.get("when") == "never":
                continue
            for source in _PIPELINE_SOURCE_RE.findall(condition):
                add(_GITLAB_SOURCE_EVENTS.get(source, source))
            if "$CI_COMMIT_TAG" in condition:
                add("tag")
            if "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH" in condition:
                add("push", tr("branche par défaut"))
            elif "$CI_COMMIT_BRANCH" in condition and "$CI_PIPELINE_SOURCE" not in condition:
                add("push")

    from_rules(workflow.get("rules"))
    for key, config in document.items():
        if isinstance(key, str) and key not in _GITLAB_RESERVED and isinstance(config, dict):
            from_rules(config.get("rules"))
            for only in _as_list(config.get("only")) if not isinstance(config.get("only"), dict) else _as_list(config["only"].get("refs")):
                if isinstance(only, str):
                    event = _GITLAB_ONLY_EVENTS.get(only)
                    if event:
                        add(event)
                    else:
                        add("push", only)
    if not events:
        add("push", tr("toutes les branches"))
    return [{"event": event, "details": details} for event, details in events.items()]


# ---------------------------------------------------------------------------
# Bitbucket Pipelines
# ---------------------------------------------------------------------------

_BITBUCKET_SECTIONS = {"default": "push", "branches": "push", "tags": "tag", "bookmarks": "push", "pull-requests": "pull_request", "custom": "manual"}


def summarize_bitbucket_pipelines(content: str) -> dict[str, Any]:
    document, error = _load(content)
    if error:
        return error
    assert document is not None
    pipelines = document.get("pipelines")
    if not isinstance(pipelines, dict):
        return _invalid(tr("Section « pipelines » absente du fichier."), None)

    triggers: dict[str, list[str]] = {}
    jobs: list[dict[str, Any]] = []
    stages: list[str] = []
    seen: set[tuple[str, str]] = set()
    default_image = document.get("image")

    def add_trigger(event: str, detail: str | None) -> None:
        details = triggers.setdefault(event, [])
        if detail and detail not in details:
            details.append(detail)

    def collect(items: Any, pipeline_label: str) -> None:
        for item in _as_list(items):
            if not isinstance(item, dict):
                continue
            if isinstance(item.get("step"), dict):
                step = item["step"]
                name = str(step.get("name") or f"Step {len(jobs) + 1}")
                if (pipeline_label, name) in seen:
                    continue
                seen.add((pipeline_label, name))
                image = step.get("image", default_image)
                runs_on = step.get("runs-on")
                jobs.append(
                    {
                        "id": f"{pipeline_label}/{name}",
                        "name": name,
                        "stage": pipeline_label,
                        "runs_on": (image.get("name") if isinstance(image, dict) else image) or (", ".join(map(str, _as_list(runs_on))) if runs_on else None),
                        "needs": [],
                        "steps": len(_as_list(step.get("script"))),
                        "uses": tr("déploiement : {value}", value=step['deployment']) if step.get("deployment") else None,
                        "matrix": False,
                    }
                )
            elif "parallel" in item:
                parallel = item["parallel"]
                collect(parallel.get("steps") if isinstance(parallel, dict) else parallel, pipeline_label)
            elif isinstance(item.get("stage"), dict):
                collect(item["stage"].get("steps"), pipeline_label)

    for section, config in pipelines.items():
        event = _BITBUCKET_SECTIONS.get(str(section), str(section))
        if section == "default":
            add_trigger(event, tr("toutes les branches"))
            stages.append("default")
            collect(config, "default")
        elif isinstance(config, dict):
            for pattern, items in config.items():
                label = f"{section}: {pattern}"
                add_trigger(event, str(pattern))
                stages.append(label)
                collect(items, label)

    return {
        "valid": True,
        "error": None,
        "error_line": None,
        "name": None,
        "triggers": [{"event": event, "details": details} for event, details in triggers.items()],
        "stages": stages,
        "jobs": jobs,
        "includes": [],
    }
