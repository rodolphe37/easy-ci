import json
import subprocess

import pytest
import yaml

from easy_ci.api import Api
from easy_ci.generation.detect import detect
from easy_ci.generation.demo_projects import _TREES
from easy_ci.generation.files import DiskFiles, MemoryFiles
from easy_ci.generation.render import default_options, generate
from easy_ci.local.service import LocalProjectsService
from easy_ci.storage import SettingsStore

PROVIDERS = ("github", "gitlab", "bitbucket")

PROJECTS = {
    "node-pnpm": {
        "package.json": json.dumps({"scripts": {"lint": "eslint .", "test": "vitest run", "build": "vite build"}, "dependencies": {"react": "19"}, "devDependencies": {"typescript": "5"}}),
        "pnpm-lock.yaml": "",
        "tsconfig.json": "{}",
        ".nvmrc": "v22.11.0",
    },
    "node-yarn-berry": {"package.json": json.dumps({"scripts": {"test": "jest"}}), "yarn.lock": "", ".yarnrc.yml": ""},
    "python-pip": {"requirements.txt": "flask\n", "requirements-dev.txt": "pytest\nflake8\n", "tests/test_app.py": ""},
    "python-poetry": {"pyproject.toml": "[tool.poetry]\nname='x'\n[tool.poetry.group.dev.dependencies]\npytest='*'\nmypy='*'\n", "poetry.lock": ""},
    "django": {"manage.py": "", "requirements.txt": "Django==5.2\n"},
    "go": {"go.mod": "module x\n\ngo 1.24\n", "go.sum": "", ".golangci.yml": ""},
    "rust": {"Cargo.toml": "[package]\nname='x'\n[dependencies]\naxum = '0.8'\n", "Cargo.lock": ""},
    "maven": {"pom.xml": "<project><properties><java.version>17</java.version></properties>spring-boot</project>", "mvnw": ""},
    "gradle": {"build.gradle.kts": "plugins { kotlin(\"jvm\") }\nkotlin { jvmToolchain(21) }\n", "gradlew": ""},
    "android": {"settings.gradle.kts": "include(\":app\")", "build.gradle.kts": "", "app/build.gradle.kts": "plugins { id(\"com.android.application\") }", "gradlew": ""},
    "php": {"composer.json": json.dumps({"require": {"php": "^8.3", "laravel/framework": "^12"}, "require-dev": {"phpstan/phpstan": "*", "laravel/pint": "*"}}), "composer.lock": ""},
    "ruby": {"Gemfile": "gem 'rails'\ngem 'rubocop'\ngem 'rspec-rails'\n", "Gemfile.lock": "", ".ruby-version": "3.3.5"},
    "dotnet": {"App.sln": "", "App.csproj": "<Project Sdk=\"Microsoft.NET.Sdk.Web\"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>"},
}


def test_detects_node_details():
    result = detect(MemoryFiles(PROJECTS["node-pnpm"]))
    (stack,) = result["stacks"]
    assert stack["id"] == "node" and stack["framework"] == "React"
    assert (stack["version"], stack["version_source"], stack["package_manager"]) == ("22", ".nvmrc", "pnpm")
    assert stack["commands"] == {
        "install": "pnpm install --frozen-lockfile",
        "lint": "pnpm run lint",
        "typecheck": "pnpm exec tsc --noEmit",
        "test": "pnpm run test",
        "build": "pnpm run build",
    }


@pytest.mark.parametrize(
    ("project", "expected"),
    [
        ("node-yarn-berry", ("node", "yarn", "yarn install --immutable", "yarn test")),
        ("python-pip", ("python", "pip", "pip install -r requirements-dev.txt", "pytest")),
        ("python-poetry", ("python", "poetry", "poetry install --no-interaction", "poetry run pytest")),
        ("django", ("python", "pip", "pip install -r requirements.txt", "python manage.py test")),
        ("go", ("go", "go modules", "go mod download", "go test -race ./...")),
        ("rust", ("rust", "cargo", "cargo fetch", "cargo test --all")),
        ("maven", ("java-maven", "Maven", None, "./mvnw -B verify")),
        ("gradle", ("java-gradle", "Gradle", None, "./gradlew test")),
        ("android", ("android", "Gradle", None, "./gradlew testDebugUnitTest")),
        ("php", ("php", "Composer", "composer install --no-interaction --prefer-dist", "php artisan test")),
        ("ruby", ("ruby", "Bundler", "bundle install --jobs 4", "bundle exec rspec")),
        ("dotnet", ("dotnet", "NuGet", "dotnet restore", "dotnet test --no-restore")),
    ],
)
def test_detects_each_stack(project, expected):
    (stack,) = detect(MemoryFiles(PROJECTS[project]))["stacks"]
    assert (stack["id"], stack["package_manager"], stack["commands"]["install"], stack["commands"]["test"]) == expected


def test_detects_versions_monorepo_docker_and_hints():
    files = MemoryFiles(
        {
            "package.json": json.dumps({"workspaces": ["packages/*"], "scripts": {"build": "turbo build"}}),
            "package-lock.json": "{}",
            "packages/ui/package.json": json.dumps({"scripts": {"build": "tsup"}}),
            "api/go.mod": "module api\n\ngo 1.23\n",
            "api/Dockerfile": "FROM golang",
            "fly.toml": "",
            ".github/workflows/old.yml": "name: old",
            "node_modules/left-pad/package.json": "{}",
        }
    )
    result = detect(files)
    assert [(s["id"], s["directory"]) for s in result["stacks"]] == [("node", "."), ("go", "api")]
    assert result["stacks"][1]["version"] == "1.23"
    assert result["docker"] == {"dockerfile": "api/Dockerfile", "context": "api", "compose": False}
    assert result["deploy_hints"] == [{"id": "fly", "label": "Fly.io", "file": "fly.toml"}]
    assert result["existing_ci"] == [".github/workflows/old.yml"]


def test_disk_files_stay_inside_project(tmp_path):
    (tmp_path / "project").mkdir()
    (tmp_path / "secret.txt").write_text("nope")
    (tmp_path / "project" / "go.mod").write_text("module x\n")
    files = DiskFiles(tmp_path / "project")
    assert files.read("../secret.txt") is None
    assert files.exists("go.mod") and files.listdir(".") == ["go.mod"]


@pytest.mark.parametrize("provider", PROVIDERS)
@pytest.mark.parametrize("project", sorted(PROJECTS))
def test_generated_pipelines_are_valid(provider, project):
    detection = detect(MemoryFiles(PROJECTS[project]))
    options = default_options(provider, detection, "main", "acme/app")
    result = generate(provider, options)
    assert result["validation"]["valid"], (result["validation"]["problems"], result["content"])
    assert result["validation"]["warnings"] == 0, result["validation"]["problems"]
    assert result["content"].startswith("# Pipeline généré par Easy CI")
    assert yaml.safe_load(result["content"])


@pytest.mark.parametrize("provider", PROVIDERS)
def test_all_options_enabled_stay_valid(provider):
    detection = detect(MemoryFiles({**PROJECTS["node-pnpm"], **{f"api/{k}": v for k, v in PROJECTS["python-poetry"].items()}, "Dockerfile": ""}))
    options = default_options(provider, detection, "develop", "acme/app")
    options["stacks"][0]["matrix"] = ["20", "22", "24"]
    options["os"] = ["ubuntu-latest", "windows-latest"]
    options["triggers"].update(tags=True, schedule="0 4 * * *")
    options["docker"].update(enabled=True, when="both")
    options["deploy"].update(enabled=True, command="./deploy.sh", environment="staging", when="both", secrets=["deploy-token"])
    result = generate(provider, options)
    assert result["validation"]["valid"], (result["validation"]["problems"], result["content"])
    document = yaml.safe_load(result["content"])
    if provider == "github":
        assert document[True]["push"] == {"branches": ["develop"], "tags": ["v*"]}
        assert document["jobs"]["node-test"]["strategy"]["matrix"] == {"version": ["20", "22", "24"], "os": ["ubuntu-latest", "windows-latest"]}
        assert document["jobs"]["deploy"]["needs"] == "docker" and document["jobs"]["deploy"]["environment"] == "staging"
    elif provider == "gitlab":
        assert document["stages"] == ["lint", "test", "build", "docker", "deploy"]
        assert document["deploy"]["rules"][0]["when"] == "manual"
        assert document["node-test"]["parallel"]["matrix"] == [{"NODE_VERSION": ["20", "22", "24"]}]
    else:
        pipelines = document["pipelines"]
        assert set(pipelines) == {"branches", "pull-requests", "tags", "custom"}
        names = [item["step"]["name"] for item in pipelines["tags"]["v*"] if "step" in item]
        assert names[-2:] == ["Image Docker", "Déploiement"]
        assert "&" in result["content"] and "*" in result["content"]  # étapes définies une fois, réutilisées par ancre


def test_disabled_steps_and_empty_project():
    detection = detect(MemoryFiles(PROJECTS["go"]))
    options = default_options("github", detection)
    for step in options["stacks"][0]["steps"].values():
        step["enabled"] = False
    result = generate("github", options)
    assert result["validation"]["valid"] and "Aucune étape active" in result["notes"][0]
    empty = generate("gitlab", default_options("gitlab", detect(MemoryFiles({"README.md": "hi"}))))
    assert empty["validation"]["valid"]


@pytest.mark.parametrize("name", sorted(_TREES))
def test_demo_trees_generate_valid_pipelines(name):
    detection = detect(MemoryFiles(_TREES[name]))
    assert detection["stacks"], name
    for provider in PROVIDERS:
        assert generate(provider, default_options(provider, detection))["validation"]["valid"]


class NoCredentials:
    def load(self, provider):
        return None

    def save(self, provider, credentials):
        return True

    def clear(self, provider):
        pass


def test_api_generation_flow_in_demo(tmp_path):
    api = Api(NoCredentials(), SettingsStore(tmp_path / "s.json"))
    api.call("start_demo")
    key = "github:acme/handbook"
    analysis = api.call("detect_project", {"key": key})["data"]
    (stack,) = analysis["detection"]["stacks"]
    assert (stack["framework"], stack["package_manager"]) == ("Astro", "pnpm")
    assert analysis["detection"]["deploy_hints"][0]["id"] == "netlify"
    assert analysis["choices"]["path_editable"] is True

    options = analysis["options"]
    options["docker"]["enabled"] = True
    preview = api.call("generate_pipeline", {"key": key, "options": options})["data"]
    assert preview["validation"]["valid"] and preview["exists"] is False and preview["existing_hash"] is None

    saved = api.call("save_ci_file", {"key": key, "path": preview["path"], "content": preview["content"], "expected_hash": None})["data"]
    assert {f["path"]: f["state"] for f in saved["status"]["ci_files"]} == {".github/workflows/ci.yml": "untracked"}
    again = api.call("generate_pipeline", {"key": key, "options": options})["data"]
    assert again["exists"] is True and again["existing_hash"] == saved["hash"]

    bad = api.call("generate_pipeline", {"key": key, "options": {**options, "path": "../evil.yml"}})
    assert bad["ok"] is False


def test_detect_on_real_clone(tmp_path, monkeypatch):
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(tmp_path / "gitconfig"))
    work = tmp_path / "app"
    work.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=work, check=True)
    (work / "Cargo.toml").write_text("[package]\nname = 'app'\n")
    service = LocalProjectsService(SettingsStore(tmp_path / "settings.json"))
    service.link("gitlab:team/app", str(work), force=True)
    result = detect(service.project_files("gitlab:team/app"))
    assert result["stacks"][0]["id"] == "rust"


@pytest.mark.parametrize("provider", PROVIDERS)
def test_deploy_uses_stack_environment_and_secrets(provider):
    detection = detect(MemoryFiles({"package.json": json.dumps({"scripts": {"build": "astro build"}}), "package-lock.json": "{}", "netlify.toml": ""}))
    options = default_options(provider, detection)
    options["deploy"].update(enabled=True, command="npm run build\nnpx netlify-cli deploy --prod --dir=dist", secrets=["NETLIFY_AUTH_TOKEN"])
    result = generate(provider, options)
    assert result["validation"]["valid"], result["content"]
    assert "npx netlify-cli deploy" in result["content"] and "npm ci" in result["content"]
    assert any("NETLIFY_AUTH_TOKEN" in note for note in result["notes"])
    if provider == "github":
        deploy = yaml.safe_load(result["content"])["jobs"]["deploy"]
        assert deploy["steps"][-1]["env"] == {"NETLIFY_AUTH_TOKEN": "${{ secrets.NETLIFY_AUTH_TOKEN }}"}
        assert deploy["steps"][1]["uses"].startswith("actions/setup-node")
