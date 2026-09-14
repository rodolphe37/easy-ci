"""Validation des fichiers CI avant enregistrement et commit.

Contrôles hors ligne, rapides (appelés à chaque frappe, avec un léger délai) :
- syntaxe YAML, avec la ligne et la colonne de l'erreur ;
- structure propre à chaque plateforme (clés obligatoires, références entre jobs,
  valeurs autorisées), chaque problème pointant la ligne concernée.

Ce n'est pas un validateur exhaustif : il attrape les erreurs qui font échouer un pipeline
avant même son démarrage. Pour GitLab, la validation officielle (CI Lint) complète ce contrôle.
"""

from __future__ import annotations

import re
from typing import Any

import yaml

from easy_ci.workflow_yaml import _CiLoader

ERROR = "error"
WARNING = "warning"


class _Report:
    def __init__(self, root: yaml.Node | None) -> None:
        self.root = root
        self.problems: list[dict[str, Any]] = []

    def add(self, severity: str, message: str, path: tuple[Any, ...] = (), *, key: bool = False) -> None:
        line, column = _position(self.root, path, key=key)
        self.problems.append({"severity": severity, "message": message, "line": line, "column": column, "path": ".".join(map(str, path)) or None})

    def error(self, message: str, *path: Any, key: bool = False) -> None:
        self.add(ERROR, message, path, key=key)

    def warning(self, message: str, *path: Any, key: bool = False) -> None:
        self.add(WARNING, message, path, key=key)


def _position(root: yaml.Node | None, path: tuple[Any, ...], *, key: bool) -> tuple[int | None, int | None]:
    """Ligne/colonne (1-indexées) du nœud désigné par un chemin de clés et d'index."""
    node = root
    key_node = None
    for part in path:
        if isinstance(node, yaml.MappingNode):
            match = next(((k, v) for k, v in node.value if _scalar(k) == str(part)), None)
            if match is None:
                break
            key_node, node = match
        elif isinstance(node, yaml.SequenceNode) and isinstance(part, int) and part < len(node.value):
            key_node, node = None, node.value[part]
        else:
            break
    target = key_node if key and key_node is not None else node
    if target is None:
        return None, None
    return target.start_mark.line + 1, target.start_mark.column + 1


def _scalar(node: yaml.Node) -> str | None:
    # Valeur brute du fichier : la clé `on` reste « on » ici, même si le chargeur la lit comme booléen.
    return node.value if isinstance(node, yaml.ScalarNode) else None


def validate(provider: str, content: str) -> dict[str, Any]:
    if not content.strip():
        return _result([{"severity": ERROR, "message": "Le fichier est vide.", "line": 1, "column": 1, "path": None}])
    try:
        root = yaml.compose(content, Loader=_CiLoader)
        document = yaml.load(content, Loader=_CiLoader)  # noqa: S506 — chargeur dérivé de SafeLoader
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        problem = getattr(exc, "problem", None) or str(exc)
        return _result(
            [
                {
                    "severity": ERROR,
                    "message": f"YAML invalide : {_translate_yaml_error(str(problem))}",
                    "line": mark.line + 1 if mark else None,
                    "column": mark.column + 1 if mark else None,
                    "path": None,
                }
            ]
        )
    report = _Report(root)
    if not isinstance(document, dict):
        report.error("Le fichier doit contenir un dictionnaire de clés YAML (clé: valeur).")
        return _result(report.problems)
    if provider == "gitlab":
        _validate_gitlab(document, report)
    elif provider == "bitbucket":
        _validate_bitbucket(document, report)
    else:
        _validate_github(document, report)
    _check_expressions(document, report, ())
    return _result(report.problems)


def _result(problems: list[dict[str, Any]]) -> dict[str, Any]:
    problems.sort(key=lambda p: (p["line"] or 0, p["column"] or 0, p["severity"] != ERROR))
    errors = sum(1 for p in problems if p["severity"] == ERROR)
    return {"valid": errors == 0, "errors": errors, "warnings": len(problems) - errors, "problems": problems}


_YAML_MESSAGES = {
    "mapping values are not allowed here": "deux-points inattendu (valeur mal indentée ou guillemets manquants)",
    "could not find expected ':'": "« : » attendu après la clé",
    "found character '\\t' that cannot start any token": "tabulation interdite en YAML : utilisez des espaces",
    "expected <block end>, but found '-'": "élément de liste mal indenté",
    "found undefined alias": "ancre YAML (*alias) introuvable",
    "found duplicate anchor": "ancre YAML (&ancre) définie deux fois",
    "expected the node content, but found '<stream end>'": "valeur manquante en fin de fichier (crochet ou guillemet non refermé ?)",
    "found unexpected end of stream": "fin de fichier inattendue (guillemet non refermé ?)",
    "found unexpected ':'": "« : » inattendu (entourez la valeur de guillemets)",
}


def _translate_yaml_error(problem: str) -> str:
    for english, french in _YAML_MESSAGES.items():
        if problem.startswith(english):
            return french
    return problem


def _check_expressions(value: Any, report: _Report, path: tuple[Any, ...]) -> None:
    """`${{ … }}` non refermé : GitHub rejette le fichier, GitLab/Bitbucket gardent le texte tel quel."""
    if isinstance(value, dict):
        for key, child in value.items():
            _check_expressions(child, report, (*path, key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _check_expressions(child, report, (*path, index))
    elif isinstance(value, str) and value.count("${{") > value.count("}}"):
        report.error("Expression « ${{ » non refermée par « }} ».", *path)


# ---------------------------------------------------------------------------
# GitHub Actions
# ---------------------------------------------------------------------------

_GITHUB_TOP = {"name", "run-name", "on", "permissions", "env", "defaults", "concurrency", "jobs"}
_GITHUB_JOB = {
    "name", "needs", "runs-on", "permissions", "environment", "concurrency", "outputs", "env", "defaults", "if", "steps",
    "timeout-minutes", "strategy", "continue-on-error", "container", "services", "uses", "with", "secrets",
}
_GITHUB_STEP = {"id", "if", "name", "uses", "run", "working-directory", "shell", "with", "env", "continue-on-error", "timeout-minutes"}
_GITHUB_EVENTS = {
    "branch_protection_rule", "check_run", "check_suite", "create", "delete", "deployment", "deployment_status", "discussion",
    "discussion_comment", "fork", "gollum", "issue_comment", "issues", "label", "merge_group", "milestone", "page_build",
    "public", "pull_request", "pull_request_review", "pull_request_review_comment", "pull_request_target", "push",
    "registry_package", "release", "repository_dispatch", "schedule", "status", "watch", "workflow_call",
    "workflow_dispatch", "workflow_run", "project", "project_card", "project_column",
}
_JOB_ID = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$")
_CRON_FIELD = re.compile(r"^[\d*/,\-A-Za-z?LW#]+$")


def _validate_github(doc: dict[str, Any], report: _Report) -> None:
    for key in doc:
        if key is True:
            continue  # clé `on` lue comme booléen
        if key not in _GITHUB_TOP:
            report.warning(f"Clé « {key} » inconnue au premier niveau d'un workflow.", key, key=True)

    triggers = doc.get("on", doc.get(True))
    if triggers is None:
        report.error("Déclencheur manquant : ajoutez une section « on: » (par exemple « on: push »).")
    else:
        events: list[str] = []
        if isinstance(triggers, str):
            events = [triggers]
        elif isinstance(triggers, list):
            events = [str(e) for e in triggers]
        elif isinstance(triggers, dict):
            events = [str(e) for e in triggers]
            schedule = triggers.get("schedule")
            if schedule is not None:
                if not isinstance(schedule, list):
                    report.error("« schedule » doit être une liste d'éléments « - cron: … ».", "on", "schedule")
                else:
                    for index, item in enumerate(schedule):
                        cron = item.get("cron") if isinstance(item, dict) else None
                        if not isinstance(cron, str) or len(cron.split()) != 5 or not all(_CRON_FIELD.match(f) for f in cron.split()):
                            report.error("Expression cron invalide : 5 champs attendus (minute heure jour mois jour-semaine).", "on", "schedule", index)
        for event in events:
            if event not in _GITHUB_EVENTS:
                report.warning(f"Événement « {event} » inconnu de GitHub Actions.", "on", event, key=True)

    jobs = doc.get("jobs")
    if jobs is None:
        report.error("Section « jobs: » manquante : un workflow doit contenir au moins un job.")
        return
    if not isinstance(jobs, dict) or not jobs:
        report.error("« jobs » doit contenir au moins un job.", "jobs")
        return

    for job_id, job in jobs.items():
        where = ("jobs", job_id)
        if not _JOB_ID.match(str(job_id)):
            report.error(f"Identifiant de job « {job_id} » invalide : lettres, chiffres, « - » et « _ », sans commencer par un chiffre.", *where, key=True)
        if not isinstance(job, dict):
            report.error(f"Le job « {job_id} » doit être un dictionnaire.", *where)
            continue
        for key in job:
            if key not in _GITHUB_JOB:
                report.warning(f"Clé « {key} » inconnue pour un job.", *where, key, key=True)
        reusable = "uses" in job
        if reusable:
            if "steps" in job:
                report.error("Un job qui appelle un workflow réutilisable (« uses ») ne peut pas avoir de « steps ».", *where, "steps", key=True)
        else:
            if "runs-on" not in job:
                report.error(f"Le job « {job_id} » doit préciser « runs-on » (par exemple ubuntu-latest).", *where, key=True)
            steps = job.get("steps")
            if not isinstance(steps, list) or not steps:
                target = (*where, "steps") if "steps" in job else where
                report.error(f"Le job « {job_id} » doit contenir une liste « steps » non vide.", *target, key=True)
            else:
                _validate_github_steps(job_id, steps, report)
        for needed in _as_list(job.get("needs")):
            if needed not in jobs:
                report.error(f"« needs » référence un job inexistant : « {needed} ».", *where, "needs")
        timeout = job.get("timeout-minutes")
        if timeout is not None and not isinstance(timeout, (int, float)) and not (isinstance(timeout, str) and "${{" in timeout):
            report.error("« timeout-minutes » doit être un nombre.", *where, "timeout-minutes")

    cycle = _find_cycle({str(k): [str(n) for n in _as_list(v.get("needs"))] for k, v in jobs.items() if isinstance(v, dict)})
    if cycle:
        report.error(f"Dépendances circulaires entre jobs : {' → '.join(cycle)}.", "jobs", cycle[0], "needs")


def _validate_github_steps(job_id: str, steps: list[Any], report: _Report) -> None:
    for index, step in enumerate(steps):
        where = ("jobs", job_id, "steps", index)
        if not isinstance(step, dict):
            report.error("Chaque étape doit être un dictionnaire (« - uses: … » ou « - run: … »).", *where)
            continue
        has_uses, has_run = "uses" in step, "run" in step
        if has_uses == has_run:
            report.error("Une étape doit contenir soit « uses », soit « run » (pas les deux).", *where)
        uses = step.get("uses")
        if isinstance(uses, str) and not uses.startswith(("./", "docker://")) and "@" not in uses:
            report.error(f"Version manquante pour l'action « {uses} » : ajoutez « @v4 », un tag ou un SHA.", *where, "uses")
        for key in step:
            if key not in _GITHUB_STEP:
                report.warning(f"Clé « {key} » inconnue pour une étape.", *where, key, key=True)


# ---------------------------------------------------------------------------
# GitLab CI
# ---------------------------------------------------------------------------

_GITLAB_GLOBAL = {"default", "include", "stages", "variables", "workflow", "image", "services", "cache", "before_script", "after_script", "spec", "types", "pages"}
_GITLAB_JOB = {
    "after_script", "allow_failure", "artifacts", "before_script", "cache", "coverage", "dast_configuration", "dependencies",
    "environment", "extends", "hooks", "id_tokens", "identity", "image", "inherit", "interruptible", "manual_confirmation",
    "needs", "only", "except", "pages", "parallel", "release", "resource_group", "retry", "rules", "run", "script", "secrets",
    "services", "stage", "tags", "timeout", "trigger", "variables", "when", "publish",
}
_GITLAB_WHEN = {"on_success", "on_failure", "always", "manual", "delayed", "never"}
_GITLAB_DEFAULT_STAGES = [".pre", "build", "test", "deploy", ".post"]


def _validate_gitlab(doc: dict[str, Any], report: _Report) -> None:
    has_include = bool(doc.get("include"))
    declared = doc.get("stages")
    if declared is not None and not isinstance(declared, list):
        report.error("« stages » doit être une liste.", "stages")
    stages = [".pre", *(str(s) for s in declared), ".post"] if isinstance(declared, list) else _GITLAB_DEFAULT_STAGES
    all_keys = {str(k) for k in doc}
    jobs = {
        str(key): value
        for key, value in doc.items()
        if str(key) not in _GITLAB_GLOBAL and not str(key).startswith(".") and isinstance(value, dict)
    }
    if not jobs and not has_include:
        report.error("Aucun job défini : ajoutez au moins un job avec un « script ».")

    for key, value in doc.items():
        name = str(key)
        if name in _GITLAB_GLOBAL or name.startswith("."):
            continue
        if not isinstance(value, dict):
            report.error(f"« {name} » n'est ni un mot-clé global ni un job valide (un job doit être un dictionnaire).", name, key=True)

    for name, job in jobs.items():
        where = (name,)
        for key in job:
            if key not in _GITLAB_JOB:
                report.warning(f"Mot-clé « {key} » inconnu pour un job GitLab.", name, key, key=True)
        if not any(field in job for field in ("script", "run", "trigger", "extends")):
            report.error(f"Le job « {name} » doit contenir un « script » (ou « trigger » / « extends »).", *where, key=True)
        script = job.get("script")
        if script is not None and not isinstance(script, (str, list)):
            report.error("« script » doit être une commande ou une liste de commandes.", name, "script")
        if isinstance(script, list) and not script:
            report.error("« script » ne peut pas être vide.", name, "script")
        stage = job.get("stage")
        if stage is not None and str(stage) not in stages:
            report.error(f"Stage « {stage} » non déclaré dans « stages » ({', '.join(stages[1:-1]) or 'aucun'}).", name, "stage")
        if "rules" in job and ("only" in job or "except" in job):
            report.error("« rules » ne peut pas être combiné avec « only » ou « except ».", name, "rules", key=True)
        when = job.get("when")
        if when is not None and when not in _GITLAB_WHEN:
            report.error(f"Valeur de « when » invalide : « {when} » ({', '.join(sorted(_GITLAB_WHEN))}).", name, "when")
        for rule_index, rule in enumerate(_as_list(job.get("rules"))):
            if isinstance(rule, dict) and rule.get("when") is not None and rule["when"] not in _GITLAB_WHEN:
                report.error(f"Valeur de « when » invalide dans une règle : « {rule['when']} ».", name, "rules", rule_index, "when")
        for extended in _as_list(job.get("extends")):
            if str(extended) not in all_keys:
                (report.warning if has_include else report.error)(f"« extends » référence « {extended} », introuvable dans ce fichier.", name, "extends")
        for need_index, need in enumerate(_as_list(job.get("needs"))):
            target = need.get("job") if isinstance(need, dict) else need
            if isinstance(need, dict) and (need.get("project") or need.get("pipeline")):
                continue
            if target is not None and str(target) not in jobs:
                (report.warning if has_include else report.error)(f"« needs » référence un job inexistant : « {target} ».", name, "needs", need_index)

    cycle = _find_cycle({name: [str(n.get("job") if isinstance(n, dict) else n) for n in _as_list(job.get("needs"))] for name, job in jobs.items()})
    if cycle:
        report.error(f"Dépendances circulaires entre jobs : {' → '.join(cycle)}.", cycle[0], "needs")


# ---------------------------------------------------------------------------
# Bitbucket Pipelines
# ---------------------------------------------------------------------------

_BITBUCKET_TOP = {"image", "clone", "options", "definitions", "pipelines", "labels"}
_BITBUCKET_SECTIONS = {"default", "branches", "tags", "bookmarks", "pull-requests", "custom"}
_BITBUCKET_STEP = {
    "name", "script", "after-script", "image", "caches", "services", "artifacts", "deployment", "trigger", "size", "max-time",
    "clone", "oidc", "runs-on", "condition", "fail-fast", "runtime",
}
_BITBUCKET_SIZES = {"1x", "2x", "4x", "8x", "16x", "32x"}


def _validate_bitbucket(doc: dict[str, Any], report: _Report) -> None:
    for key in doc:
        if key not in _BITBUCKET_TOP:
            report.warning(f"Clé « {key} » inconnue au premier niveau de bitbucket-pipelines.yml.", key, key=True)
    pipelines = doc.get("pipelines")
    if pipelines is None:
        report.error("Section « pipelines: » manquante.")
        return
    if not isinstance(pipelines, dict) or not pipelines:
        report.error("« pipelines » doit contenir au moins une section (default, branches, pull-requests…).", "pipelines")
        return
    for section, config in pipelines.items():
        if section not in _BITBUCKET_SECTIONS:
            report.error(f"Section « {section} » inconnue (attendu : {', '.join(sorted(_BITBUCKET_SECTIONS))}).", "pipelines", section, key=True)
            continue
        if section == "default":
            _validate_bitbucket_items(config, report, ("pipelines", "default"))
        elif isinstance(config, dict):
            for pattern, items in config.items():
                _validate_bitbucket_items(items, report, ("pipelines", section, pattern))
        else:
            report.error(f"« {section} » doit associer des motifs (branches, tags…) à des listes d'étapes.", "pipelines", section)


def _validate_bitbucket_items(items: Any, report: _Report, path: tuple[Any, ...]) -> None:
    if isinstance(items, dict) and "steps" in items:  # pipelines personnalisés avec variables
        items = items["steps"]
    if not isinstance(items, list) or not items:
        report.error("Une liste d'étapes (« - step: … ») est attendue.", *path)
        return
    for index, item in enumerate(items):
        where = (*path, index)
        if not isinstance(item, dict):
            report.error("Chaque élément doit être « step », « parallel » ou « stage ».", *where)
        elif "step" in item:
            _validate_bitbucket_step(item["step"], report, (*where, "step"))
        elif "parallel" in item:
            parallel = item["parallel"]
            steps = parallel.get("steps") if isinstance(parallel, dict) else parallel
            _validate_bitbucket_items(steps, report, (*where, "parallel"))
        elif "stage" in item:
            stage = item["stage"]
            _validate_bitbucket_items(stage.get("steps") if isinstance(stage, dict) else None, report, (*where, "stage", "steps"))
        elif "variables" not in item:
            report.error("Élément inconnu : « step », « parallel » ou « stage » attendu.", *where)


def _validate_bitbucket_step(step: Any, report: _Report, path: tuple[Any, ...]) -> None:
    if not isinstance(step, dict):
        report.error("« step » doit être un dictionnaire.", *path)
        return
    script = step.get("script")
    if not isinstance(script, list) or not script:
        report.error("Chaque étape doit contenir un « script » (liste de commandes non vide).", *path, key=True)
    for key in step:
        if key not in _BITBUCKET_STEP:
            report.warning(f"Clé « {key} » inconnue pour une étape.", *path, key, key=True)
    size = step.get("size")
    if size is not None and str(size) not in _BITBUCKET_SIZES:
        report.error(f"Taille « {size} » invalide ({', '.join(sorted(_BITBUCKET_SIZES))}).", *path, "size")
    trigger = step.get("trigger")
    if trigger is not None and trigger not in ("manual", "automatic"):
        report.error("« trigger » doit valoir « manual » ou « automatic ».", *path, "trigger")
    max_time = step.get("max-time")
    if max_time is not None and not isinstance(max_time, int):
        report.error("« max-time » doit être un nombre de minutes.", *path, "max-time")


# ---------------------------------------------------------------------------


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _find_cycle(graph: dict[str, list[str]]) -> list[str] | None:
    visiting: list[str] = []
    done: set[str] = set()

    def visit(node: str) -> list[str] | None:
        if node in visiting:
            return [*visiting[visiting.index(node) :], node]
        if node in done or node not in graph:
            return None
        visiting.append(node)
        for child in graph[node]:
            found = visit(child)
            if found:
                return found
        visiting.pop()
        done.add(node)
        return None

    for start in graph:
        found = visit(start)
        if found:
            return found
    return None
