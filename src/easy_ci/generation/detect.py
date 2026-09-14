"""Détection de la stack d'un projet à partir de ses fichiers (sans exécuter quoi que ce soit).

Chaque stack trouvée décrit : langage, framework, version d'exécution, gestionnaire de paquets,
commandes d'installation / lint / vérification de types / tests / build, et les fichiers qui
justifient chaque déduction (affichés dans l'interface).
"""

from __future__ import annotations

import json
import re
import tomllib
from typing import Any

from easy_ci.generation.files import ProjectFiles, _join

# Versions par défaut quand le projet n'en précise pas (LTS / stables en septembre 2026).
DEFAULT_VERSIONS = {"node": "24", "python": "3.13", "go": "1.27", "java": "21", "php": "8.4", "ruby": "3.4", "dotnet": "10.0", "rust": "stable"}

STACK_LABELS = {
    "node": "Node.js",
    "python": "Python",
    "go": "Go",
    "rust": "Rust",
    "java-maven": "Java (Maven)",
    "java-gradle": "Java / Kotlin (Gradle)",
    "android": "Android (Gradle)",
    "php": "PHP",
    "ruby": "Ruby",
    "dotnet": ".NET",
}

_NODE_FRAMEWORKS = [
    ("next", "Next.js"), ("nuxt", "Nuxt"), ("@remix-run/react", "Remix"), ("astro", "Astro"), ("@sveltejs/kit", "SvelteKit"),
    ("@angular/core", "Angular"), ("vue", "Vue"), ("svelte", "Svelte"), ("react", "React"), ("@nestjs/core", "NestJS"),
    ("express", "Express"), ("fastify", "Fastify"), ("electron", "Electron"), ("vite", "Vite"),
]
_PYTHON_FRAMEWORKS = [("django", "Django"), ("fastapi", "FastAPI"), ("flask", "Flask"), ("streamlit", "Streamlit")]
_DEPLOY_HINTS = [
    ("vercel.json", "vercel", "Vercel"), ("netlify.toml", "netlify", "Netlify"), ("fly.toml", "fly", "Fly.io"),
    ("render.yaml", "render", "Render"), ("firebase.json", "firebase", "Firebase"), ("serverless.yml", "serverless", "Serverless Framework"),
    ("app.yaml", "gae", "Google App Engine"), ("Procfile", "heroku", "Heroku / Procfile"), ("Chart.yaml", "helm", "Helm"),
    ("wrangler.toml", "cloudflare", "Cloudflare Workers"),
]
_CI_FILES = [".gitlab-ci.yml", "bitbucket-pipelines.yml", ".circleci/config.yml", "Jenkinsfile", "azure-pipelines.yml", ".travis.yml"]


def detect(files: ProjectFiles) -> dict[str, Any]:
    stacks: list[dict[str, Any]] = []
    directories = ["."] + [name for name in files.listdir(".") if files.is_dir(name) and not name.startswith(".")]
    for directory in directories:
        for detector in (_node, _python, _go, _rust, _java, _php, _ruby, _dotnet):
            stack = detector(files, directory)
            if stack is None:
                continue
            # Un sous-dossier géré par la racine (workspace JS/Rust, module Gradle/Maven) n'est pas une stack distincte.
            if directory != "." and any(_covered_by_root(root, stack) for root in stacks if root["directory"] == "."):
                continue
            stacks.append(stack)

    dockerfile = next((path for path in ("Dockerfile", "docker/Dockerfile", "Containerfile") if files.exists(path)), None)
    if dockerfile is None:
        dockerfile = next((_join(d, "Dockerfile") for d in directories[1:] if files.exists(_join(d, "Dockerfile"))), None)
    hints = [{"id": hint_id, "label": label, "file": name} for name, hint_id, label in _DEPLOY_HINTS if files.exists(name)]
    if any(files.exists(name) for name in ("k8s", "kubernetes", "manifests")):
        hints.append({"id": "kubernetes", "label": "Kubernetes", "file": next(n for n in ("k8s", "kubernetes", "manifests") if files.exists(n))})
    if any(name.endswith(".tf") for name in files.listdir(".")) or files.is_dir("terraform"):
        hints.append({"id": "terraform", "label": "Terraform", "file": "terraform" if files.is_dir("terraform") else "*.tf"})

    existing = [path for path in _CI_FILES if files.exists(path)]
    existing += [f".github/workflows/{name}" for name in files.listdir(".github/workflows") if name.endswith((".yml", ".yaml"))]
    return {
        "stacks": stacks,
        "docker": {"dockerfile": dockerfile, "context": dockerfile.rsplit("/", 1)[0] if "/" in dockerfile else ".", "compose": files.exists("docker-compose.yml") or files.exists("compose.yaml")} if dockerfile else None,
        "deploy_hints": hints,
        "existing_ci": existing,
    }


_JVM = {"java-maven", "java-gradle", "android"}


def _covered_by_root(root: dict[str, Any], stack: dict[str, Any]) -> bool:
    if root["id"] in _JVM and stack["id"] in _JVM:
        return True
    return root["id"] == stack["id"] and bool(root.get("workspace"))


def _stack(stack_id: str, directory: str, **extra: Any) -> dict[str, Any]:
    return {
        "id": stack_id,
        "label": STACK_LABELS[stack_id],
        "directory": directory,
        "framework": None,
        "version": None,
        "version_source": None,
        "package_manager": None,
        "workspace": False,
        "commands": {"install": None, "lint": None, "typecheck": None, "test": None, "build": None},
        "evidence": [],
        **extra,
    }


def _first_line(text: str | None) -> str | None:
    if not text:
        return None
    line = text.strip().splitlines()[0].strip() if text.strip() else ""
    return line or None


def _major(version: str | None) -> str | None:
    if not version:
        return None
    match = re.search(r"(\d+(?:\.\d+)?)", version)
    return match.group(1) if match else None


# ---------------------------------------------------------------------------
# Node.js
# ---------------------------------------------------------------------------


def _node(files: ProjectFiles, directory: str) -> dict[str, Any] | None:
    raw = files.read(_join(directory, "package.json"))
    if raw is None:
        return None
    try:
        package = json.loads(raw)
    except ValueError:
        package = {}
    if not isinstance(package, dict):
        package = {}
    stack = _stack("node", directory)
    stack["evidence"].append(_join(directory, "package.json"))
    scripts = package.get("scripts") if isinstance(package.get("scripts"), dict) else {}
    dependencies = {**(package.get("dependencies") or {}), **(package.get("devDependencies") or {})}

    # Gestionnaire de paquets : lockfile (dans le dossier ou à la racine d'un monorepo), puis champ packageManager.
    lockfiles = [("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("bun.lockb", "bun"), ("bun.lock", "bun"), ("package-lock.json", "npm")]
    manager = None
    for candidate_dir in dict.fromkeys([directory, "."]):
        for lockfile, name in lockfiles:
            if files.exists(_join(candidate_dir, lockfile)):
                manager = name
                stack["evidence"].append(_join(candidate_dir, lockfile))
                break
        if manager:
            break
    declared = str(package.get("packageManager") or "")
    if not manager and declared:
        manager = declared.split("@", 1)[0] or None
    manager = manager or "npm"
    stack["package_manager"] = manager
    yarn_berry = manager == "yarn" and (files.exists(_join(directory, ".yarnrc.yml")) or files.exists(".yarnrc.yml") or declared.startswith("yarn@") and not declared.startswith("yarn@1"))

    # Version de Node.
    for name in (".nvmrc", ".node-version"):
        version = _major(_first_line(files.read(_join(directory, name))) or _first_line(files.read(name)))
        if version:
            stack["version"], stack["version_source"] = version.split(".")[0], name
            break
    if not stack["version"]:
        engines = (package.get("engines") or {}).get("node") if isinstance(package.get("engines"), dict) else None
        volta = (package.get("volta") or {}).get("node") if isinstance(package.get("volta"), dict) else None
        found = _major(volta) or _node_engine(engines)
        if found:
            stack["version"], stack["version_source"] = found.split(".")[0], "package.json"
    stack["version"] = stack["version"] or DEFAULT_VERSIONS["node"]

    for dependency, label in _NODE_FRAMEWORKS:
        if dependency in dependencies:
            stack["framework"] = label
            break
    stack["workspace"] = bool(package.get("workspaces")) or files.exists(_join(directory, "pnpm-workspace.yaml")) or files.exists(_join(directory, "turbo.json"))

    install = {"npm": "npm ci", "pnpm": "pnpm install --frozen-lockfile", "yarn": "yarn install --immutable" if yarn_berry else "yarn install --frozen-lockfile", "bun": "bun install --frozen-lockfile"}[manager]
    if manager == "npm" and not files.exists(_join(directory, "package-lock.json")) and not files.exists("package-lock.json"):
        install = "npm install"
    run = {"npm": "npm run", "pnpm": "pnpm run", "yarn": "yarn", "bun": "bun run"}[manager]

    def script(*names: str) -> str | None:
        for name in names:
            value = scripts.get(name)
            if isinstance(value, str) and value.strip() and "no test specified" not in value:
                return f"{run} {name}"
        return None

    typecheck = script("typecheck", "type-check", "check-types", "tsc", "check")
    if not typecheck and files.exists(_join(directory, "tsconfig.json")) and "typescript" in dependencies:
        typecheck = {"npm": "npx tsc --noEmit", "pnpm": "pnpm exec tsc --noEmit", "yarn": "yarn tsc --noEmit", "bun": "bunx tsc --noEmit"}[manager]
    stack["commands"] = {
        "install": install,
        "lint": script("lint", "lint:ci", "eslint"),
        "typecheck": typecheck,
        "test": script("test:ci", "test", "test:unit"),
        "build": script("build"),
    }
    return stack


def _node_engine(spec: Any) -> str | None:
    if not isinstance(spec, str):
        return None
    numbers = [int(n) for n in re.findall(r"(\d+)(?:\.\d+)*", spec)]
    return str(max(numbers)) if numbers else None


# ---------------------------------------------------------------------------
# Python
# ---------------------------------------------------------------------------


def _python(files: ProjectFiles, directory: str) -> dict[str, Any] | None:
    markers = ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile", "setup.cfg", "manage.py"]
    present = [name for name in markers if files.exists(_join(directory, name))]
    if not present:
        return None
    stack = _stack("python", directory, evidence=[_join(directory, name) for name in present])
    pyproject_text = files.read(_join(directory, "pyproject.toml")) or ""
    try:
        pyproject = tomllib.loads(pyproject_text) if pyproject_text else {}
    except tomllib.TOMLDecodeError:
        pyproject = {}
    requirements = "\n".join(filter(None, (files.read(_join(directory, name)) for name in ("requirements.txt", "requirements-dev.txt", "requirements/dev.txt", "Pipfile", "setup.cfg"))))
    haystack = f"{pyproject_text}\n{requirements}".lower()

    if files.exists(_join(directory, "uv.lock")):
        manager, install, runner = "uv", "uv sync --locked --all-extras", "uv run "
        stack["evidence"].append(_join(directory, "uv.lock"))
    elif files.exists(_join(directory, "poetry.lock")):
        manager, install, runner = "poetry", "poetry install --no-interaction", "poetry run "
        stack["evidence"].append(_join(directory, "poetry.lock"))
    elif files.exists(_join(directory, "Pipfile")):
        manager, install, runner = "pipenv", "pipenv install --dev --deploy", "pipenv run "
    else:
        manager, runner = "pip", ""
        extras = (pyproject.get("project") or {}).get("optional-dependencies") or {}
        extra = next((name for name in ("dev", "test", "tests") if name in extras), None)
        if files.exists(_join(directory, "requirements-dev.txt")):
            install = "pip install -r requirements-dev.txt"
        elif extra:
            install = f'pip install -e ".[{extra}]"'
        elif files.exists(_join(directory, "requirements.txt")):
            install = "pip install -r requirements.txt"
        elif pyproject:
            install = "pip install -e ."
        else:
            install = "pip install -r requirements.txt"
    stack["package_manager"] = manager

    version = _major(_first_line(files.read(_join(directory, ".python-version"))))
    if version:
        stack["version"], stack["version_source"] = version, ".python-version"
    else:
        requires = str((pyproject.get("project") or {}).get("requires-python") or "")
        minimum = re.search(r">=\s*(3\.\d+)", requires)
        if minimum and _version_tuple(minimum.group(1)) > _version_tuple(DEFAULT_VERSIONS["python"]):
            stack["version"], stack["version_source"] = minimum.group(1), "pyproject.toml"
    stack["version"] = stack["version"] or DEFAULT_VERSIONS["python"]

    for dependency, label in _PYTHON_FRAMEWORKS:
        if re.search(rf"\b{dependency}\b", haystack):
            stack["framework"] = label
            break

    has_tests = files.is_dir(_join(directory, "tests")) or files.is_dir(_join(directory, "test"))
    lint = f"{runner}ruff check ." if ("ruff" in haystack or files.exists(_join(directory, "ruff.toml"))) else (f"{runner}flake8" if "flake8" in haystack else None)
    typecheck = f"{runner}mypy ." if "mypy" in haystack else (f"{runner}pyright" if "pyright" in haystack else None)
    if "pytest" in haystack or (has_tests and not files.exists(_join(directory, "manage.py"))):
        test = f"{runner}pytest"
    elif files.exists(_join(directory, "manage.py")):
        test = f"{runner}python manage.py test"
    else:
        test = None
    build = f"{runner}python -m build" if manager == "pip" and "[build-system]" in pyproject_text and not files.exists(_join(directory, "manage.py")) else None
    if manager == "uv" and "[build-system]" in pyproject_text:
        build = "uv build"
    stack["commands"] = {"install": install, "lint": lint, "typecheck": typecheck, "test": test, "build": build}
    return stack


def _version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split(".") if part.isdigit())


# ---------------------------------------------------------------------------
# Go, Rust
# ---------------------------------------------------------------------------


def _go(files: ProjectFiles, directory: str) -> dict[str, Any] | None:
    text = files.read(_join(directory, "go.mod"))
    if text is None:
        return None
    stack = _stack("go", directory, evidence=[_join(directory, "go.mod")], package_manager="go modules")
    match = re.search(r"^go\s+(\d+\.\d+)", text, re.MULTILINE)
    stack["version"], stack["version_source"] = (match.group(1), "go.mod") if match else (DEFAULT_VERSIONS["go"], None)
    golangci = next((name for name in (".golangci.yml", ".golangci.yaml", ".golangci.toml") if files.exists(_join(directory, name))), None)
    if golangci:
        stack["evidence"].append(_join(directory, golangci))
    stack["framework"] = next((label for dep, label in (("gin-gonic/gin", "Gin"), ("labstack/echo", "Echo"), ("gofiber/fiber", "Fiber"), ("go-chi/chi", "chi")) if dep in text), None)
    stack["commands"] = {
        "install": "go mod download",
        "lint": "golangci-lint run" if golangci else "go vet ./...",
        "typecheck": None,
        "test": "go test -race ./...",
        "build": "go build ./...",
    }
    return stack


def _rust(files: ProjectFiles, directory: str) -> dict[str, Any] | None:
    text = files.read(_join(directory, "Cargo.toml"))
    if text is None:
        return None
    stack = _stack("rust", directory, evidence=[_join(directory, "Cargo.toml")], package_manager="cargo")
    toolchain = files.read(_join(directory, "rust-toolchain.toml")) or files.read(_join(directory, "rust-toolchain"))
    channel = re.search(r'channel\s*=\s*"([^"]+)"', toolchain or "") if toolchain else None
    stack["version"], stack["version_source"] = (channel.group(1), "rust-toolchain.toml") if channel else ("stable", None)
    stack["workspace"] = "[workspace]" in text
    stack["framework"] = next((label for dep, label in (("axum", "Axum"), ("actix-web", "Actix Web"), ("rocket", "Rocket"), ("tauri", "Tauri")) if re.search(rf"^{dep}\s*=", text, re.MULTILINE)), None)
    stack["commands"] = {
        "install": "cargo fetch",
        "lint": "cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings",
        "typecheck": None,
        "test": "cargo test --all",
        "build": "cargo build --release",
    }
    return stack


# ---------------------------------------------------------------------------
# JVM
# ---------------------------------------------------------------------------


def _java(files: ProjectFiles, directory: str) -> dict[str, Any] | None:
    pom = files.read(_join(directory, "pom.xml"))
    gradle_name = next((name for name in ("build.gradle.kts", "build.gradle") if files.exists(_join(directory, name))), None)
    if pom is None and gradle_name is None:
        return None
    if pom is not None:
        wrapper = files.exists(_join(directory, "mvnw"))
        mvn = "./mvnw" if wrapper else "mvn"
        stack = _stack("java-maven", directory, evidence=[_join(directory, "pom.xml")], package_manager="Maven")
        match = re.search(r"<(?:java\.version|maven\.compiler\.release|maven\.compiler\.source|release)>\s*(\d+)", pom)
        stack["framework"] = "Spring Boot" if "spring-boot" in pom else None
        stack["commands"] = {"install": None, "lint": None, "typecheck": None, "test": f"{mvn} -B verify", "build": f"{mvn} -B package -DskipTests"}
    else:
        text = files.read(_join(directory, gradle_name)) or ""
        settings = files.read(_join(directory, "settings.gradle.kts")) or files.read(_join(directory, "settings.gradle")) or ""
        app_module = files.read(_join(directory, "app/build.gradle.kts")) or files.read(_join(directory, "app/build.gradle")) or ""
        android = "com.android" in text or "com.android" in settings or "com.android" in app_module
        gradle = "./gradlew" if files.exists(_join(directory, "gradlew")) else "gradle"
        stack = _stack("android" if android else "java-gradle", directory, evidence=[_join(directory, gradle_name)], package_manager="Gradle")
        match = re.search(r"(?:jvmToolchain\((\d+)\)|JavaVersion\.VERSION_(\d+)|languageVersion\.set\(JavaLanguageVersion\.of\((\d+)\)\))", text)
        if match:
            match = re.search(r"(\d+)", match.group(0))
        stack["framework"] = "Spring Boot" if "org.springframework.boot" in text else ("Kotlin" if gradle_name.endswith(".kts") and "kotlin" in text else None)
        if android:
            stack["commands"] = {"install": None, "lint": f"{gradle} lint", "typecheck": None, "test": f"{gradle} testDebugUnitTest", "build": f"{gradle} assembleDebug"}
        else:
            stack["commands"] = {"install": None, "lint": None, "typecheck": None, "test": f"{gradle} test", "build": f"{gradle} build -x test"}
    version = match.group(1) if match else None
    stack["version"], stack["version_source"] = (version, stack["evidence"][0].rsplit("/", 1)[-1]) if version else (DEFAULT_VERSIONS["java"], None)
    return stack


# ---------------------------------------------------------------------------
# PHP, Ruby, .NET
# ---------------------------------------------------------------------------


def _php(files: ProjectFiles, directory: str) -> dict[str, Any] | None:
    raw = files.read(_join(directory, "composer.json"))
    if raw is None:
        return None
    try:
        composer = json.loads(raw)
    except ValueError:
        composer = {}
    stack = _stack("php", directory, evidence=[_join(directory, "composer.json")], package_manager="Composer")
    require = {**(composer.get("require") or {}), **(composer.get("require-dev") or {})}
    php_spec = str((composer.get("require") or {}).get("php") or "")
    match = re.search(r"(\d+\.\d+)", php_spec)
    stack["version"], stack["version_source"] = (max(match.group(1), DEFAULT_VERSIONS["php"], key=_version_tuple), "composer.json") if match else (DEFAULT_VERSIONS["php"], None)
    stack["framework"] = "Laravel" if "laravel/framework" in require else ("Symfony" if any(k.startswith("symfony/framework") for k in require) else None)
    stack["commands"] = {
        "install": "composer install --no-interaction --prefer-dist",
        "lint": "vendor/bin/php-cs-fixer fix --dry-run" if "friendsofphp/php-cs-fixer" in require else ("vendor/bin/pint --test" if "laravel/pint" in require else None),
        "typecheck": "vendor/bin/phpstan analyse" if "phpstan/phpstan" in require or "larastan/larastan" in require else None,
        "test": "php artisan test" if stack["framework"] == "Laravel" else ("vendor/bin/phpunit" if "phpunit/phpunit" in require else ("vendor/bin/pest" if "pestphp/pest" in require else None)),
        "build": None,
    }
    return stack


def _ruby(files: ProjectFiles, directory: str) -> dict[str, Any] | None:
    gemfile = files.read(_join(directory, "Gemfile"))
    if gemfile is None:
        return None
    stack = _stack("ruby", directory, evidence=[_join(directory, "Gemfile")], package_manager="Bundler")
    version = _major(_first_line(files.read(_join(directory, ".ruby-version"))))
    stack["version"], stack["version_source"] = (version, ".ruby-version") if version else (DEFAULT_VERSIONS["ruby"], None)
    stack["framework"] = "Rails" if re.search(r"gem ['\"]rails['\"]", gemfile) else None
    stack["commands"] = {
        "install": "bundle install --jobs 4",
        "lint": "bundle exec rubocop" if "rubocop" in gemfile else None,
        "typecheck": None,
        "test": "bundle exec rspec" if "rspec" in gemfile else ("bin/rails test" if stack["framework"] == "Rails" else "bundle exec rake test"),
        "build": None,
    }
    return stack


def _dotnet(files: ProjectFiles, directory: str) -> dict[str, Any] | None:
    names = files.listdir(directory)
    project = next((name for name in names if name.endswith(".sln") or name.endswith(".slnx")), None) or next((name for name in names if name.endswith((".csproj", ".fsproj"))), None)
    if project is None:
        return None
    stack = _stack("dotnet", directory, evidence=[_join(directory, project)], package_manager="NuGet")
    csproj = next((files.read(_join(directory, name)) for name in names if name.endswith((".csproj", ".fsproj"))), None) or ""
    match = re.search(r"<TargetFrameworks?>\s*net(\d+\.\d+)", csproj)
    stack["version"], stack["version_source"] = (match.group(1), "csproj") if match else (DEFAULT_VERSIONS["dotnet"], None)
    stack["framework"] = "ASP.NET Core" if "Microsoft.NET.Sdk.Web" in csproj else None
    stack["commands"] = {
        "install": "dotnet restore",
        "lint": "dotnet format --verify-no-changes",
        "typecheck": None,
        "test": "dotnet test --no-restore",
        "build": "dotnet build --no-restore --configuration Release",
    }
    return stack
