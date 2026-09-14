"""Génération des fichiers CI à partir de la stack détectée et des choix de l'assistant.

Modèles déterministes (aucune IA) : les mêmes options produisent toujours le même fichier.
Le résultat est un YAML lisible, commenté, validé avant d'être proposé à l'écriture.
"""

from __future__ import annotations

import copy
import re
from datetime import date
from typing import Any

import yaml

from easy_ci.generation.detect import DEFAULT_VERSIONS, STACK_LABELS
from easy_ci.validation import validate
from easy_ci.workflow_yaml import summarize

STEP_ORDER = ("lint", "typecheck", "test", "build")
STEP_LABELS = {"lint": "Lint", "typecheck": "Vérification des types", "test": "Tests", "build": "Build"}

# Versions vérifiées sur GitHub en septembre 2026 (tags majeurs existants).
ACTIONS = {
    "checkout": "actions/checkout@v7",
    "setup-node": "actions/setup-node@v7",
    "setup-python": "actions/setup-python@v7",
    "setup-go": "actions/setup-go@v7",
    "setup-java": "actions/setup-java@v6",
    "setup-dotnet": "actions/setup-dotnet@v6",
    "setup-uv": "astral-sh/setup-uv@v10.1.0",
    "pnpm": "pnpm/action-setup@v6",
    "bun": "oven-sh/setup-bun@v2",
    "php": "shivammathur/setup-php@v2",
    "ruby": "ruby/setup-ruby@v1",
    "rust-toolchain": "dtolnay/rust-toolchain@stable",
    "rust-cache": "Swatinem/rust-cache@v2",
    "golangci": "golangci/golangci-lint-action@v9",
    "gradle": "gradle/actions/setup-gradle@v6",
    "buildx": "docker/setup-buildx-action@v4",
    "docker-login": "docker/login-action@v4",
    "docker-metadata": "docker/metadata-action@v6",
    "docker-build": "docker/build-push-action@v7",
}

IMAGES = {
    "node": "node:{version}",
    "python": "python:{version}",
    "go": "golang:{version}",
    "rust": "rust:1",
    "java-maven": "maven:3-eclipse-temurin-{version}",
    "java-gradle": "eclipse-temurin:{version}-jdk",
    "android": "ghcr.io/cirruslabs/android-sdk:35",
    "php": "php:{version}-cli",
    "ruby": "ruby:{version}",
    "dotnet": "mcr.microsoft.com/dotnet/sdk:{version}",
}


# ---------------------------------------------------------------------------
# Options par défaut
# ---------------------------------------------------------------------------


def default_options(provider: str, detection: dict[str, Any], default_branch: str = "main", full_name: str = "") -> dict[str, Any]:
    stacks = []
    for stack in detection.get("stacks", []):
        commands = stack["commands"]
        stacks.append(
            {
                "id": stack["id"],
                "directory": stack["directory"],
                "enabled": True,
                "version": stack["version"] or DEFAULT_VERSIONS.get(stack["id"].split("-")[0], ""),
                "package_manager": stack.get("package_manager"),
                "matrix": [],
                "install": commands.get("install") or "",
                "steps": {step: {"enabled": bool(commands.get(step)), "command": commands.get(step) or ""} for step in STEP_ORDER},
            }
        )
    docker = detection.get("docker")
    owner_repo = full_name.lower()
    registry_image = {"github": f"ghcr.io/{owner_repo}", "gitlab": "$CI_REGISTRY_IMAGE", "bitbucket": f"docker.io/{owner_repo.split('/', 1)[-1]}"}.get(provider, owner_repo)
    return {
        "path": default_path(provider),
        "name": "CI",
        "stacks": stacks,
        "triggers": {"push_default": True, "pull_requests": True, "tags": False, "schedule": "", "manual": True},
        "default_branch": default_branch,
        "cache": True,
        "concurrency": True,
        "os": ["ubuntu-latest"],
        "docker": {
            "enabled": False,
            "dockerfile": (docker or {}).get("dockerfile") or "Dockerfile",
            "context": (docker or {}).get("context") or ".",
            "push": True,
            "registry": "ghcr" if provider == "github" else ("gitlab" if provider == "gitlab" else "dockerhub"),
            "image": registry_image,
            "when": "default_branch",
        },
        "deploy": {"enabled": False, "environment": "production", "command": "", "secrets": [], "use_stack": True, "manual": True, "when": "default_branch"},
    }


def choices(provider: str) -> dict[str, Any]:
    """Valeurs proposées par l'assistant (listes déroulantes, cases à cocher)."""
    registries = {
        "github": [("ghcr", "GitHub Container Registry (ghcr.io)"), ("dockerhub", "Docker Hub"), ("custom", "Autre registre")],
        "gitlab": [("gitlab", "Registre du projet GitLab"), ("dockerhub", "Docker Hub"), ("custom", "Autre registre")],
        "bitbucket": [("dockerhub", "Docker Hub ou autre registre")],
    }[provider]
    return {
        "paths": {"github": [".github/workflows/ci.yml", ".github/workflows/build.yml", ".github/workflows/pipeline.yml"], "gitlab": [".gitlab-ci.yml"], "bitbucket": ["bitbucket-pipelines.yml"]}[provider],
        "path_editable": provider == "github",
        "os": [{"id": "ubuntu-latest", "label": "Linux"}, {"id": "macos-latest", "label": "macOS"}, {"id": "windows-latest", "label": "Windows"}] if provider == "github" else [],
        "registries": [{"id": key, "label": label} for key, label in registries],
        "supports": {"concurrency": provider != "bitbucket", "os_matrix": provider == "github", "schedule_in_file": provider == "github"},
        "step_labels": STEP_LABELS,
        "stack_labels": STACK_LABELS,
    }


def default_path(provider: str) -> str:
    return {"gitlab": ".gitlab-ci.yml", "bitbucket": "bitbucket-pipelines.yml"}.get(provider, ".github/workflows/ci.yml")


# ---------------------------------------------------------------------------
# Rendu YAML
# ---------------------------------------------------------------------------


class _Dumper(yaml.SafeDumper):
    def ignore_aliases(self, data: Any) -> bool:  # jamais d'ancres générées automatiquement (&id001)
        return True

    def increase_indent(self, flow: bool = False, indentless: bool = False) -> None:
        super().increase_indent(flow, False)  # listes indentées sous leur clé (style courant des fichiers CI)


class _AnchorDumper(_Dumper):
    """Réutilise les définitions d'étapes Bitbucket via des ancres nommées (&lint / *lint)."""

    def ignore_aliases(self, data: Any) -> bool:
        return not (isinstance(data, dict) and "_anchor" in data) and super().ignore_aliases(data)

    def generate_anchor(self, node: yaml.Node) -> str:
        for key, value in node.value:
            if key.value == "_anchor":
                return value.value
        return super().generate_anchor(node)


def _str(dumper: yaml.SafeDumper, value: str) -> yaml.Node:
    style = "|" if "\n" in value else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", value, style=style)


class Flow(list):
    """Liste courte rendue sur une ligne : [lint, test]."""


def _flow(dumper: yaml.SafeDumper, value: Flow) -> yaml.Node:
    return dumper.represent_sequence("tag:yaml.org,2002:seq", list(value), flow_style=True)


def _none(dumper: yaml.SafeDumper, value: None) -> yaml.Node:
    return dumper.represent_scalar("tag:yaml.org,2002:null", "")


_Dumper.add_representer(str, _str)
_Dumper.add_representer(Flow, _flow)
_Dumper.add_representer(type(None), _none)


def _dump(document: dict[str, Any], anchors: bool = False) -> str:
    text = yaml.dump(document, Dumper=_AnchorDumper if anchors else _Dumper, sort_keys=False, allow_unicode=True, width=10_000, default_flow_style=False)
    text = re.sub(r"^'on':", "on:", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*_anchor: .*\n", "", text, flags=re.MULTILINE)
    text = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)
    # Une ligne vide entre les blocs de premier niveau et entre les jobs, pour la lisibilité.
    lines = text.splitlines()
    output: list[str] = []
    for index, line in enumerate(lines):
        top_level = bool(line) and not line.startswith((" ", "-", "#"))
        job_level = re.match(r"^  [A-Za-z0-9_.-]+:$", line) and output and output[-1].startswith("jobs:") is False and _in_block(lines, index, ("jobs:",))
        if index > 0 and (top_level or job_level) and output and output[-1] != "":
            output.append("")
        output.append(line)
    return "\n".join(output) + "\n"


def _in_block(lines: list[str], index: int, headers: tuple[str, ...]) -> bool:
    for previous in reversed(lines[:index]):
        if previous and not previous.startswith(" "):
            return previous in headers
    return False


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "app"


def _prefix(stack: dict[str, Any], multi: bool) -> tuple[str, str]:
    """(préfixe d'identifiant de job, préfixe de nom affiché) — utile quand plusieurs stacks coexistent."""
    if not multi:
        return "", ""
    base = stack["directory"] if stack["directory"] != "." else stack["id"].split("-")[0]
    return f"{_slug(base)}-", f"{stack['directory'] if stack['directory'] != '.' else STACK_LABELS[stack['id']]} · "


def _enabled_steps(stack: dict[str, Any]) -> dict[str, str]:
    return {step: stack["steps"][step]["command"].strip() for step in STEP_ORDER if stack["steps"].get(step, {}).get("enabled") and stack["steps"][step]["command"].strip()}


def _header(provider: str, options: dict[str, Any]) -> str:
    stacks = [s for s in options["stacks"] if s["enabled"]]
    summary = ", ".join(
        f"{STACK_LABELS[s['id']]} {s['version']}".strip() + (f" ({s['directory']})" if s["directory"] != "." else "") for s in stacks
    ) or "aucune stack"
    lines = [
        f"# Pipeline généré par Easy CI le {date.today().strftime('%d/%m/%Y')}.",
        f"# Stack : {summary}.",
        "# Relisez les commandes et adaptez-les à votre projet avant de commiter.",
    ]
    if options["deploy"]["enabled"] and not options["deploy"]["command"].strip():
        lines.append("# ⚠ Déploiement : remplacez la commande d'exemple par votre commande réelle.")
    return "\n".join(lines) + "\n\n"


def generate(provider: str, options: dict[str, Any]) -> dict[str, Any]:
    options = copy.deepcopy(options)
    if provider == "gitlab":
        document, notes = _gitlab(options)
    elif provider == "bitbucket":
        document, notes = _bitbucket(options)
    else:
        document, notes = _github(options)
    content = _header(provider, options) + _dump(document, anchors=provider == "bitbucket")
    return {
        "path": options.get("path") or default_path(provider),
        "content": content,
        "validation": validate(provider, content),
        "summary": summarize(provider, content),
        "notes": notes,
    }


def _deploy_command(options: dict[str, Any]) -> str:
    return options["deploy"]["command"].strip() or 'echo "Remplacez cette ligne par votre commande de déploiement"'


def _deploy_stack(options: dict[str, Any]) -> dict[str, Any] | None:
    """Stack dont l'environnement (runtime + dépendances) sert au job de déploiement."""
    if not options["deploy"].get("use_stack", True):
        return None
    return next((s for s in options["stacks"] if s["enabled"]), None)


def _secrets(options: dict[str, Any]) -> list[str]:
    names = [re.sub(r"[^A-Za-z0-9_]", "_", str(name).strip()).upper() for name in options["deploy"].get("secrets") or []]
    return [name for name in dict.fromkeys(names) if name]


def _secrets_note(provider: str, names: list[str]) -> str | None:
    if not names:
        return None
    where = {
        "github": "Settings › Secrets and variables › Actions",
        "gitlab": "Settings › CI/CD › Variables (cochez « Masquer » et « Protéger »)",
        "bitbucket": "Repository settings › Deployments (variables sécurisées de l'environnement)",
    }[provider]
    return f"Déploiement : ajoutez {', '.join(names)} dans {where}."


# ---------------------------------------------------------------------------
# GitHub Actions
# ---------------------------------------------------------------------------


def _github_setup(stack: dict[str, Any], version_expr: str, cache: bool) -> list[dict[str, Any]]:
    stack_id, manager, directory = stack["id"], stack.get("package_manager"), stack["directory"]
    lock_path = lambda name: name if directory == "." else f"{directory}/{name}"  # noqa: E731
    steps: list[dict[str, Any]] = []
    if stack_id == "node":
        if manager == "yarn":
            steps.append({"run": "corepack enable"})
        if manager == "pnpm":
            steps.append({"uses": ACTIONS["pnpm"]})
        if manager == "bun":
            steps.append({"uses": ACTIONS["bun"]})
        with_: dict[str, Any] = {"node-version": version_expr}
        if cache and manager in ("npm", "pnpm", "yarn"):
            with_["cache"] = manager
            if directory != ".":
                with_["cache-dependency-path"] = lock_path({"npm": "package-lock.json", "pnpm": "pnpm-lock.yaml", "yarn": "yarn.lock"}[manager])
        steps.append({"uses": ACTIONS["setup-node"], "with": with_})
    elif stack_id == "python":
        if manager == "uv":
            steps.append({"uses": ACTIONS["setup-uv"], "with": {"python-version": version_expr, "enable-cache": cache}})
        else:
            with_ = {"python-version": version_expr}
            if cache and manager in ("pip", "poetry", "pipenv"):
                with_["cache"] = manager
            if manager == "poetry":
                steps.append({"run": "pipx install poetry"})
            if manager == "pipenv":
                steps.append({"run": "pipx install pipenv"})
            steps.append({"uses": ACTIONS["setup-python"], "with": with_})
    elif stack_id == "go":
        with_ = {"go-version": version_expr, "cache": cache}
        if directory != ".":
            with_["cache-dependency-path"] = lock_path("go.sum")
        steps.append({"uses": ACTIONS["setup-go"], "with": with_})
    elif stack_id == "rust":
        steps.append({"uses": ACTIONS["rust-toolchain"], "with": {"toolchain": version_expr, "components": "clippy, rustfmt"}})
        if cache:
            steps.append({"uses": ACTIONS["rust-cache"]} if directory == "." else {"uses": ACTIONS["rust-cache"], "with": {"workspaces": directory}})
    elif stack_id in ("java-maven", "java-gradle", "android"):
        with_ = {"distribution": "temurin", "java-version": version_expr}
        if cache and stack_id == "java-maven":
            with_["cache"] = "maven"
        steps.append({"uses": ACTIONS["setup-java"], "with": with_})
        if stack_id != "java-maven" and cache:
            steps.append({"uses": ACTIONS["gradle"]})
    elif stack_id == "php":
        steps.append({"uses": ACTIONS["php"], "with": {"php-version": version_expr, "tools": "composer"}})
    elif stack_id == "ruby":
        with_ = {"ruby-version": version_expr, "bundler-cache": cache}
        if directory != ".":
            with_["working-directory"] = directory
        steps.append({"uses": ACTIONS["ruby"], "with": with_})
    elif stack_id == "dotnet":
        steps.append({"uses": ACTIONS["setup-dotnet"], "with": {"dotnet-version": f"{version_expr}.x" if not version_expr.startswith("${{") else version_expr}})
    return steps


def _github_condition(when: str, default_branch: str) -> str:
    branch = f"github.ref == 'refs/heads/{default_branch}'"
    tag = "startsWith(github.ref, 'refs/tags/')"
    return {"tags": tag, "both": f"{branch} || {tag}"}.get(when, branch)


def _github(options: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    notes: list[str] = []
    triggers = options["triggers"]
    default_branch = options.get("default_branch") or "main"
    on: dict[str, Any] = {}
    if triggers.get("push_default") or triggers.get("tags"):
        push: dict[str, Any] = {}
        if triggers.get("push_default"):
            push["branches"] = Flow([default_branch])
        if triggers.get("tags") or options["docker"]["enabled"] and options["docker"]["when"] in ("tags", "both") or options["deploy"]["enabled"] and options["deploy"]["when"] in ("tags", "both"):
            push["tags"] = Flow(["v*"])
        on["push"] = push
    if triggers.get("pull_requests"):
        on["pull_request"] = None
    if triggers.get("schedule", "").strip():
        on["schedule"] = [{"cron": triggers["schedule"].strip()}]
    if triggers.get("manual"):
        on["workflow_dispatch"] = None
    if not on:
        on["workflow_dispatch"] = None
        notes.append("Aucun déclencheur choisi : le workflow ne se lancera que manuellement.")

    document: dict[str, Any] = {"name": options.get("name") or "CI", "on": on, "permissions": {"contents": "read"}}
    if options.get("concurrency"):
        document["concurrency"] = {"group": "${{ github.workflow }}-${{ github.ref }}", "cancel-in-progress": True}

    jobs: dict[str, Any] = {}
    stacks = [s for s in options["stacks"] if s["enabled"]]
    multi = len(stacks) > 1
    final_jobs: list[str] = []
    os_list = [o for o in options.get("os") or ["ubuntu-latest"] if o] or ["ubuntu-latest"]

    for stack in stacks:
        steps = _enabled_steps(stack)
        if not steps:
            continue
        job_prefix, name_prefix = _prefix(stack, multi)
        versions = [str(v) for v in stack.get("matrix") or [] if str(v).strip()]
        base: dict[str, Any] = {"runs-on": "ubuntu-latest"}
        if stack["directory"] != ".":
            base["defaults"] = {"run": {"working-directory": stack["directory"]}}

        def job_steps(commands: list[tuple[str, str]], version_expr: str, stack: dict[str, Any] = stack) -> list[dict[str, Any]]:
            items: list[dict[str, Any]] = [{"uses": ACTIONS["checkout"]}, *_github_setup(stack, version_expr, options.get("cache", True))]
            if stack.get("install", "").strip() and not (stack["id"] == "ruby" and options.get("cache", True)):
                items.append({"name": "Installation des dépendances", "run": stack["install"].strip()})
            for label, command in commands:
                if stack["id"] == "go" and command.startswith("golangci-lint"):
                    items.append({"name": label, "uses": ACTIONS["golangci"]} if stack["directory"] == "." else {"name": label, "uses": ACTIONS["golangci"], "with": {"working-directory": stack["directory"]}})
                else:
                    items.append({"name": label, "run": command})
            return items

        created: list[str] = []
        quality = [(STEP_LABELS[s], steps[s]) for s in ("lint", "typecheck") if s in steps]
        if quality:
            job_id = f"{job_prefix}lint"
            jobs[job_id] = {"name": f"{name_prefix}Lint", **copy.deepcopy(base), "steps": job_steps(quality, stack["version"])}
            created.append(job_id)
        if "test" in steps:
            job_id = f"{job_prefix}test"
            job: dict[str, Any] = {"name": f"{name_prefix}Tests", **copy.deepcopy(base)}
            matrix: dict[str, Any] = {}
            if len(versions) > 1:
                matrix["version"] = Flow(versions)
            if len(os_list) > 1:
                matrix["os"] = Flow(os_list)
                job["runs-on"] = "${{ matrix.os }}"
            if matrix:
                job["strategy"] = {"fail-fast": False, "matrix": matrix}
                labels = [f"${{{{ matrix.{key} }}}}" for key in matrix]
                job["name"] = f"{name_prefix}Tests ({', '.join(labels)})"
            job["steps"] = job_steps([(STEP_LABELS["test"], steps["test"])], "${{ matrix.version }}" if "version" in matrix else stack["version"])
            jobs[job_id] = job
            created.append(job_id)
        if "build" in steps:
            job_id = f"{job_prefix}build"
            job = {"name": f"{name_prefix}Build", **copy.deepcopy(base)}
            if created:
                job["needs"] = Flow(created) if len(created) > 1 else created[0]
            job["steps"] = job_steps([(STEP_LABELS["build"], steps["build"])], stack["version"])
            jobs[job_id] = job
            final_jobs.append(job_id)
        else:
            final_jobs.extend(created)

    docker = options["docker"]
    if docker["enabled"]:
        registry = docker.get("registry", "ghcr")
        image = docker.get("image") or "ghcr.io/${{ github.repository }}"
        steps_docker: list[dict[str, Any]] = [{"uses": ACTIONS["checkout"]}, {"uses": ACTIONS["buildx"]}]
        push = bool(docker.get("push", True))
        if push:
            if registry == "ghcr":
                login = {"registry": "ghcr.io", "username": "${{ github.actor }}", "password": "${{ secrets.GITHUB_TOKEN }}"}
            elif registry == "dockerhub":
                login = {"username": "${{ secrets.DOCKERHUB_USERNAME }}", "password": "${{ secrets.DOCKERHUB_TOKEN }}"}
                notes.append("Ajoutez les secrets DOCKERHUB_USERNAME et DOCKERHUB_TOKEN dans les paramètres du dépôt.")
            else:
                login = {"registry": image.split("/", 1)[0], "username": "${{ secrets.REGISTRY_USERNAME }}", "password": "${{ secrets.REGISTRY_PASSWORD }}"}
                notes.append("Ajoutez les secrets REGISTRY_USERNAME et REGISTRY_PASSWORD dans les paramètres du dépôt.")
            steps_docker.append({"name": "Connexion au registre", "uses": ACTIONS["docker-login"], "with": login})
        steps_docker.append(
            {
                "name": "Tags de l'image",
                "id": "meta",
                "uses": ACTIONS["docker-metadata"],
                "with": {"images": image, "tags": "type=ref,event=branch\ntype=semver,pattern={{version}}\ntype=sha"},
            }
        )
        steps_docker.append(
            {
                "name": "Build et envoi de l'image",
                "uses": ACTIONS["docker-build"],
                "with": {
                    "context": docker.get("context") or ".",
                    "file": docker.get("dockerfile") or "Dockerfile",
                    "push": push,
                    "tags": "${{ steps.meta.outputs.tags }}",
                    "labels": "${{ steps.meta.outputs.labels }}",
                    "cache-from": "type=gha",
                    "cache-to": "type=gha,mode=max",
                },
            }
        )
        job = {"name": "Image Docker", "runs-on": "ubuntu-latest"}
        if final_jobs:
            job["needs"] = Flow(final_jobs) if len(final_jobs) > 1 else final_jobs[0]
        job["if"] = _github_condition(docker.get("when", "default_branch"), default_branch)
        job["permissions"] = {"contents": "read", "packages": "write"}
        job["steps"] = steps_docker
        jobs["docker"] = job
        final_jobs = ["docker"]

    deploy = options["deploy"]
    if deploy["enabled"]:
        job = {"name": "Déploiement", "runs-on": "ubuntu-latest"}
        if final_jobs:
            job["needs"] = Flow(final_jobs) if len(final_jobs) > 1 else final_jobs[0]
        job["if"] = _github_condition(deploy.get("when", "default_branch"), default_branch)
        job["environment"] = deploy.get("environment") or "production"
        stack = _deploy_stack(options)
        steps_deploy: list[dict[str, Any]] = [{"uses": ACTIONS["checkout"]}]
        if stack:
            if stack["directory"] != ".":
                job["defaults"] = {"run": {"working-directory": stack["directory"]}}
            steps_deploy += _github_setup(stack, stack["version"], options.get("cache", True))
            if stack.get("install", "").strip() and not (stack["id"] == "ruby" and options.get("cache", True)):
                steps_deploy.append({"name": "Installation des dépendances", "run": stack["install"].strip()})
        step: dict[str, Any] = {"name": "Déployer", "run": _deploy_command(options)}
        if _secrets(options):
            step["env"] = {name: f"${{{{ secrets.{name} }}}}" for name in _secrets(options)}
        job["steps"] = [*steps_deploy, step]
        jobs["deploy"] = job
        if note := _secrets_note("github", _secrets(options)):
            notes.append(note)
        if deploy.get("manual"):
            notes.append(
                f"Validation manuelle : dans Settings › Environments › {job['environment']}, activez « Required reviewers » pour exiger une approbation avant chaque déploiement."
            )

    if not jobs:
        jobs["ci"] = {"name": "CI", "runs-on": "ubuntu-latest", "steps": [{"uses": ACTIONS["checkout"]}, {"run": 'echo "Ajoutez vos étapes ici"'}]}
        notes.append("Aucune étape active : un job d'exemple a été ajouté.")
    document["jobs"] = jobs
    return document, notes


# ---------------------------------------------------------------------------
# GitLab CI
# ---------------------------------------------------------------------------

_GITLAB_CACHE = {
    "node": ({"npm": ".npm/", "pnpm": ".pnpm-store/", "yarn": ".yarn-cache/", "bun": ".bun-cache/"}, ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"]),
    "python": ({"pip": ".cache/pip/", "uv": ".cache/uv/", "poetry": ".cache/pypoetry/", "pipenv": ".cache/pip/"}, ["uv.lock", "poetry.lock", "requirements.txt", "Pipfile.lock"]),
}


def _gitlab_prepare(stack: dict[str, Any], cache: bool) -> tuple[dict[str, Any], list[str], dict[str, str]]:
    """(variables, commandes préalables, cache) propres à une stack."""
    stack_id, manager = stack["id"], stack.get("package_manager")
    variables: dict[str, str] = {}
    before: list[str] = []
    if stack["directory"] != ".":
        before.append(f"cd {stack['directory']}")
    prefix = f"{stack['directory']}/" if stack["directory"] != "." else ""
    cache_config: dict[str, Any] = {}
    if stack_id == "node":
        if manager in ("pnpm", "yarn"):
            before.append("corepack enable")
        if manager == "pnpm":
            before.append("pnpm config set store-dir .pnpm-store")
        if manager == "bun":
            before.append("npm install --global bun")
        cache_config = {"key": {"files": Flow([f"{prefix}{name}" for name in {"npm": ["package-lock.json"], "pnpm": ["pnpm-lock.yaml"], "yarn": ["yarn.lock"], "bun": ["bun.lock"]}.get(manager or "npm", ["package-lock.json"])])}, "paths": Flow([f"{prefix}node_modules/"])}
        if manager == "npm":
            variables["npm_config_cache"] = "$CI_PROJECT_DIR/.npm"
            cache_config["paths"] = Flow([".npm/"])
    elif stack_id == "python":
        if manager == "uv":
            variables["UV_CACHE_DIR"] = "$CI_PROJECT_DIR/.cache/uv"
            before.append("pip install uv")
            cache_config = {"key": {"files": Flow([f"{prefix}uv.lock"])}, "paths": Flow([".cache/uv/"])}
        else:
            variables["PIP_CACHE_DIR"] = "$CI_PROJECT_DIR/.cache/pip"
            if manager == "poetry":
                before.append("pip install poetry")
            if manager == "pipenv":
                before.append("pip install pipenv")
            cache_config = {"key": "pip-$CI_COMMIT_REF_SLUG", "paths": Flow([".cache/pip/"])}
    elif stack_id == "go":
        variables["GOPATH"] = "$CI_PROJECT_DIR/.go"
        cache_config = {"key": {"files": Flow([f"{prefix}go.sum"])}, "paths": Flow([".go/pkg/mod/"])}
        if stack["steps"]["lint"]["enabled"] and stack["steps"]["lint"]["command"].startswith("golangci"):
            before.append("go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest")
    elif stack_id == "rust":
        variables["CARGO_HOME"] = "$CI_PROJECT_DIR/.cargo"
        before.append("rustup component add clippy rustfmt")
        cache_config = {"key": {"files": Flow([f"{prefix}Cargo.lock"])}, "paths": Flow([".cargo/", f"{prefix}target/"])}
    elif stack_id == "java-maven":
        variables["MAVEN_OPTS"] = "-Dmaven.repo.local=$CI_PROJECT_DIR/.m2/repository"
        cache_config = {"key": "maven-$CI_COMMIT_REF_SLUG", "paths": Flow([".m2/repository/"])}
    elif stack_id in ("java-gradle", "android"):
        variables["GRADLE_USER_HOME"] = "$CI_PROJECT_DIR/.gradle"
        cache_config = {"key": "gradle-$CI_COMMIT_REF_SLUG", "paths": Flow([".gradle/caches/", ".gradle/wrapper/"])}
    elif stack_id == "php":
        before += ["apt-get update -qq && apt-get install -y -qq git unzip", "curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer"]
        cache_config = {"key": {"files": Flow([f"{prefix}composer.lock"])}, "paths": Flow([f"{prefix}vendor/"])}
    elif stack_id == "ruby":
        variables["BUNDLE_PATH"] = "vendor/bundle"
        cache_config = {"key": {"files": Flow([f"{prefix}Gemfile.lock"])}, "paths": Flow([f"{prefix}vendor/bundle/"])}
    elif stack_id == "dotnet":
        variables["NUGET_PACKAGES"] = "$CI_PROJECT_DIR/.nuget/packages"
        cache_config = {"key": "nuget-$CI_COMMIT_REF_SLUG", "paths": Flow([".nuget/packages/"])}
    if stack.get("install", "").strip():
        before.append(stack["install"].strip())
    return variables, before, cache_config if cache else {}


def _gitlab_rules(when: str, manual: bool = False) -> list[dict[str, Any]]:
    conditions = {"tags": ["$CI_COMMIT_TAG"], "both": ["$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH", "$CI_COMMIT_TAG"]}.get(when, ["$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH"])
    rules = []
    for condition in conditions:
        rule: dict[str, Any] = {"if": condition}
        if manual:
            rule["when"] = "manual"
        rules.append(rule)
    return rules


def _gitlab(options: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    notes: list[str] = []
    triggers = options["triggers"]
    rules = []
    if triggers.get("pull_requests"):
        rules.append({"if": '$CI_PIPELINE_SOURCE == "merge_request_event"'})
    if triggers.get("pull_requests") and triggers.get("push_default"):
        # Évite les pipelines en double (branche + merge request) quand une MR est ouverte.
        rules.append({"if": "$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS", "when": "never"})
    if triggers.get("push_default"):
        rules.append({"if": "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH"})
    if triggers.get("tags") or any(options[key]["enabled"] and options[key]["when"] in ("tags", "both") for key in ("docker", "deploy")):
        rules.append({"if": "$CI_COMMIT_TAG"})
    if triggers.get("schedule", "").strip():
        rules.append({"if": '$CI_PIPELINE_SOURCE == "schedule"'})
        notes.append(f"Planification : créez un « Pipeline schedule » ({triggers['schedule'].strip()}) dans Build › Pipeline schedules.")
    if triggers.get("manual"):
        rules.append({"if": '$CI_PIPELINE_SOURCE == "web"'})

    document: dict[str, Any] = {}
    if rules:
        document["workflow"] = {"rules": rules}
    stacks = [s for s in options["stacks"] if s["enabled"]]
    multi = len(stacks) > 1
    stages: list[str] = []
    jobs: dict[str, Any] = {}
    variables: dict[str, str] = {}
    templates: dict[int, str] = {}
    if options.get("concurrency"):
        document["default"] = {"interruptible": True}

    def add_stage(name: str) -> None:
        if name not in stages:
            stages.append(name)

    for stack in stacks:
        steps = _enabled_steps(stack)
        if not steps:
            continue
        job_prefix, _ = _prefix(stack, multi)
        stack_vars, before, cache = _gitlab_prepare(stack, options.get("cache", True))
        variables.update(stack_vars)
        template_name = f".{job_prefix}setup" if multi else f".{stack['id'].split('-')[0]}"
        template: dict[str, Any] = {"image": IMAGES[stack["id"]].format(version=stack["version"])}
        if cache:
            template["cache"] = cache
        if before:
            template["before_script"] = before
        jobs[template_name] = template
        templates[id(stack)] = template_name
        for step in STEP_ORDER:
            if step not in steps:
                continue
            stage = {"typecheck": "lint"}.get(step, step)
            add_stage(stage)
            job: dict[str, Any] = {"extends": template_name, "stage": stage, "script": [steps[step]]}
            versions = [str(v) for v in stack.get("matrix") or [] if str(v).strip()]
            if step == "test" and len(versions) > 1:
                variable = f"{stack['id'].split('-')[0].upper()}_VERSION"
                job["image"] = IMAGES[stack["id"]].format(version=f"${variable}")
                job["parallel"] = {"matrix": [{variable: Flow(versions)}]}
            if step == "test" and stack["id"] in ("python",) and "pytest" in steps[step]:
                job["script"] = [f"{steps[step]} --junitxml=report.xml"]
                job["artifacts"] = {"when": "always", "reports": {"junit": f"{stack['directory']}/report.xml" if stack["directory"] != "." else "report.xml"}}
            jobs[f"{job_prefix}{step}"] = job

    docker = options["docker"]
    if docker["enabled"]:
        add_stage("docker")
        registry = docker.get("registry", "gitlab")
        image = docker.get("image") or "$CI_REGISTRY_IMAGE"
        login = {
            "gitlab": 'echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"',
            "dockerhub": 'echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin',
        }.get(registry, 'echo "$REGISTRY_PASSWORD" | docker login -u "$REGISTRY_USERNAME" --password-stdin "$REGISTRY_HOST"')
        if registry == "dockerhub":
            notes.append("Ajoutez les variables CI/CD DOCKERHUB_USERNAME et DOCKERHUB_TOKEN (masquées) dans Settings › CI/CD › Variables.")
        elif registry not in ("gitlab",):
            notes.append("Ajoutez les variables CI/CD REGISTRY_HOST, REGISTRY_USERNAME et REGISTRY_PASSWORD dans Settings › CI/CD › Variables.")
        script = [
            f'docker build -f {docker.get("dockerfile") or "Dockerfile"} -t "{image}:$CI_COMMIT_SHORT_SHA" {docker.get("context") or "."}',
        ]
        if docker.get("push", True):
            script += [
                f'docker push "{image}:$CI_COMMIT_SHORT_SHA"',
                f'if [ -n "$CI_COMMIT_TAG" ]; then docker tag "{image}:$CI_COMMIT_SHORT_SHA" "{image}:$CI_COMMIT_TAG" && docker push "{image}:$CI_COMMIT_TAG"; fi',
                f'if [ "$CI_COMMIT_BRANCH" = "$CI_DEFAULT_BRANCH" ]; then docker tag "{image}:$CI_COMMIT_SHORT_SHA" "{image}:latest" && docker push "{image}:latest"; fi',
            ]
        job = {
            "stage": "docker",
            "image": "docker:27",
            "services": Flow(["docker:27-dind"]),
            "variables": {"DOCKER_TLS_CERTDIR": "/certs"},
        }
        if docker.get("push", True):
            job["before_script"] = [login]
        job["script"] = script
        job["rules"] = _gitlab_rules(docker.get("when", "default_branch"))
        jobs["docker-image"] = job

    deploy = options["deploy"]
    if deploy["enabled"]:
        add_stage("deploy")
        stack = _deploy_stack(options)
        job = {"stage": "deploy"}
        if stack and id(stack) in templates:
            job["extends"] = templates[id(stack)]
        elif stack:
            stack_vars, before, _ = _gitlab_prepare(stack, False)
            variables.update(stack_vars)
            job["image"] = IMAGES[stack["id"]].format(version=stack["version"])
            if before:
                job["before_script"] = before
        else:
            job["image"] = "alpine:3.22"
        job["environment"] = {"name": deploy.get("environment") or "production"}
        job["script"] = [_deploy_command(options)]
        job["rules"] = _gitlab_rules(deploy.get("when", "default_branch"), manual=bool(deploy.get("manual")))
        jobs["deploy"] = job
        if note := _secrets_note("gitlab", _secrets(options)):
            notes.append(note)
        if deploy.get("manual"):
            notes.append("Le déploiement attend une validation manuelle : bouton ▶ sur le pipeline dans GitLab.")

    if not stages:
        add_stage("test")
        jobs["ci"] = {"stage": "test", "image": "alpine:3.22", "script": ['echo "Ajoutez vos étapes ici"']}
        notes.append("Aucune étape active : un job d'exemple a été ajouté.")

    ordered: dict[str, Any] = {}
    if "workflow" in document:
        ordered["workflow"] = document["workflow"]
    ordered["stages"] = Flow(stages)
    if variables:
        ordered["variables"] = variables
    if "default" in document:
        ordered["default"] = document["default"]
    ordered.update(jobs)
    return ordered, notes


# ---------------------------------------------------------------------------
# Bitbucket Pipelines
# ---------------------------------------------------------------------------

_BITBUCKET_CACHES = {"node": "node", "python": "pip", "java-maven": "maven", "java-gradle": "gradle", "android": "gradle", "php": "composer", "dotnet": "dotnetcore"}


def _bitbucket_prepare(stack: dict[str, Any]) -> list[str]:
    prepare: list[str] = []
    if stack["directory"] != ".":
        prepare.append(f"cd {stack['directory']}")
    manager = stack.get("package_manager")
    if stack["id"] == "node" and manager in ("pnpm", "yarn"):
        prepare.append("corepack enable")
    if stack["id"] == "python" and manager in ("uv", "poetry", "pipenv"):
        prepare.append(f"pip install {manager}")
    if stack["id"] == "rust":
        prepare.append("rustup component add clippy rustfmt")
    if stack.get("install", "").strip():
        prepare.append(stack["install"].strip())
    return prepare


def _bitbucket(options: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    notes: list[str] = []
    triggers = options["triggers"]
    stacks = [s for s in options["stacks"] if s["enabled"]]
    multi = len(stacks) > 1
    quality_steps: list[dict[str, Any]] = []
    build_steps: list[dict[str, Any]] = []
    custom_caches: dict[str, Any] = {}
    definitions: list[dict[str, Any]] = []
    used_anchors: set[str] = set()

    def _unique_anchor(name: str) -> str:
        base = _slug(name.replace("·", " "))
        anchor, index = base, 2
        while anchor in used_anchors:
            anchor, index = f"{base}-{index}", index + 1
        used_anchors.add(anchor)
        return anchor

    for stack in stacks:
        steps = _enabled_steps(stack)
        if not steps:
            continue
        _, name_prefix = _prefix(stack, multi)
        image = IMAGES[stack["id"]].format(version=stack["version"])
        prepare = _bitbucket_prepare(stack)
        manager = stack.get("package_manager")
        caches: list[str] = []
        if options.get("cache", True):
            if stack["id"] == "node" and manager == "pnpm":
                custom_caches["pnpm"] = "$HOME/.local/share/pnpm/store"
                caches.append("pnpm")
            elif stack["id"] in _BITBUCKET_CACHES:
                caches.append(_BITBUCKET_CACHES[stack["id"]])

        def step(name: str, commands: list[str], versioned_image: str = image, caches: list[str] = caches, prepare: list[str] = prepare) -> dict[str, Any]:
            item: dict[str, Any] = {"_anchor": _unique_anchor(name), "name": name, "image": versioned_image}
            if caches:
                item["caches"] = Flow(caches)
            item["script"] = [*prepare, *commands]
            definitions.append({"step": item})
            return item

        quality = [steps[s] for s in ("lint", "typecheck") if s in steps]
        if quality:
            quality_steps.append(step(f"{name_prefix}Lint", quality))
        if "test" in steps:
            versions = [str(v) for v in stack.get("matrix") or [] if str(v).strip()]
            if len(versions) > 1:
                for version in versions:
                    quality_steps.append(step(f"{name_prefix}Tests ({version})", [steps["test"]], IMAGES[stack["id"]].format(version=version)))
            else:
                quality_steps.append(step(f"{name_prefix}Tests", [steps["test"]]))
        if "build" in steps:
            build_steps.append(step(f"{name_prefix}Build", [steps["build"]]))

    def checks() -> list[dict[str, Any]]:
        # Même objet partout : le dumper le définit une fois (&ancre) puis le référence (*ancre).
        items: list[dict[str, Any]] = []
        if len(quality_steps) > 1:
            items.append({"parallel": {"steps": [{"step": item} for item in quality_steps]}})
        else:
            items += [{"step": item} for item in quality_steps]
        items += [{"step": item} for item in build_steps]
        return items

    docker = options["docker"]
    deploy = options["deploy"]

    def delivery(target: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        if docker["enabled"] and docker.get("when", "default_branch") in (target, "both"):
            image = docker.get("image") or "$DOCKER_IMAGE"
            tag = "$BITBUCKET_TAG" if target == "tags" else "$BITBUCKET_COMMIT"
            script = [f"docker build -f {docker.get('dockerfile') or 'Dockerfile'} -t {image}:{tag} {docker.get('context') or '.'}"]
            if docker.get("push", True):
                script = ['echo "$DOCKER_PASSWORD" | docker login --username "$DOCKER_USERNAME" --password-stdin', *script, f"docker push {image}:{tag}"]
            items.append({"step": {"name": "Image Docker", "services": Flow(["docker"]), "caches": Flow(["docker"]), "script": script}})
        if deploy["enabled"] and deploy.get("when", "default_branch") in (target, "both"):
            item: dict[str, Any] = {"name": "Déploiement", "deployment": deploy.get("environment") or "production"}
            stack = _deploy_stack(options)
            if stack:
                item["image"] = IMAGES[stack["id"]].format(version=stack["version"])
            if deploy.get("manual"):
                item["trigger"] = "manual"
            item["script"] = [*(_bitbucket_prepare(stack) if stack else []), _deploy_command(options)]
            items.append({"step": item})
        return items

    if docker["enabled"] and docker.get("push", True):
        notes.append("Ajoutez les variables DOCKER_USERNAME et DOCKER_PASSWORD (sécurisées) dans Repository settings › Repository variables.")
    if note := _secrets_note("bitbucket", _secrets(options)) if deploy["enabled"] else None:
        notes.append(note)
    if deploy["enabled"] and deploy.get("environment") not in ("test", "staging", "production"):
        notes.append(f"Bitbucket n'accepte que les environnements test, staging et production par défaut : créez « {deploy.get('environment')} » dans Deployments.")

    pipelines: dict[str, Any] = {}
    default_branch = options.get("default_branch") or "main"
    if triggers.get("push_default"):
        pipelines["branches"] = {default_branch: checks() + delivery("default_branch")}
    if triggers.get("pull_requests"):
        pipelines["pull-requests"] = {"**": checks()}
    if triggers.get("tags") or any(options[key]["enabled"] and options[key]["when"] in ("tags", "both") for key in ("docker", "deploy")):
        pipelines["tags"] = {"v*": checks() + delivery("tags")}
    custom: dict[str, Any] = {}
    if triggers.get("manual"):
        custom["run-ci"] = checks()
    if triggers.get("schedule", "").strip():
        custom["nightly"] = checks()
        notes.append(f"Planification : créez un « Schedule » ({triggers['schedule'].strip()}) sur le pipeline personnalisé « nightly » dans Pipelines › Schedules.")
    if custom:
        pipelines["custom"] = custom
    if not pipelines or not any(pipelines.values()):
        pipelines = {"default": checks() or [{"step": {"name": "CI", "script": ['echo "Ajoutez vos étapes ici"']}}]}
    for section in pipelines.values():
        if isinstance(section, dict):
            for key, items in list(section.items()):
                if not items:
                    section[key] = [{"step": {"name": "CI", "script": ['echo "Ajoutez vos étapes ici"']}}]

    document: dict[str, Any] = {}
    first = next((s for s in stacks if _enabled_steps(s)), None)
    document["image"] = IMAGES[first["id"]].format(version=first["version"]) if first else "atlassian/default-image:4"
    if custom_caches or definitions:
        document["definitions"] = {}
        if custom_caches:
            document["definitions"]["caches"] = custom_caches
        if definitions:
            document["definitions"]["steps"] = definitions
    document["pipelines"] = pipelines
    return document, notes
