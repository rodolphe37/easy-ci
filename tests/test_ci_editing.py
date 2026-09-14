import json
import subprocess
from pathlib import Path

import httpx
import pytest

from easy_ci.api import Api
from easy_ci.bitbucket.service import BitbucketClient, BitbucketService
from easy_ci.errors import EasyCIError, FileConflictError
from easy_ci.github.client import GitHubClient
from easy_ci.github.service import GitHubService
from easy_ci.gitlab.service import GitLabClient, GitLabService
from easy_ci.local.service import LocalProjectsService
from easy_ci.storage import SettingsStore
from easy_ci.validation import validate

KEY = "github:acme/app"
CI = ".github/workflows/ci.yml"
VALID = "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: make test\n"


@pytest.fixture(autouse=True)
def isolated_git(monkeypatch, tmp_path):
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(tmp_path / "gitconfig"))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.delenv("GIT_AUTHOR_NAME", raising=False)


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


@pytest.fixture
def repo(tmp_path):
    bare = tmp_path / "remote.git"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(bare))
    work = tmp_path / "app"
    git(tmp_path, "clone", "-q", str(bare), str(work))
    git(work, "config", "user.name", "Marie")
    git(work, "config", "user.email", "marie@example.org")
    (work / ".github/workflows").mkdir(parents=True)
    (work / CI).write_text(VALID)
    (work / "notes.txt").write_text("brouillon\n")
    git(work, "add", CI)
    git(work, "commit", "-q", "-m", "ci")
    git(work, "push", "-q", "origin", "main")
    git(work, "remote", "add", "github", "git@github.com:acme/app.git")
    git(work, "remote", "set-head", "origin", "main")
    service = LocalProjectsService(SettingsStore(tmp_path / "settings.json"))
    service.link(KEY, str(work))
    return {"work": work, "bare": bare, "service": service}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_validation_accepts_valid_files():
    assert validate("github", VALID) == {"valid": True, "errors": 0, "warnings": 0, "problems": []}
    assert validate("gitlab", "stages: [test]\ntest:\n  stage: test\n  script: [pytest]\n")["valid"]
    assert validate("bitbucket", "pipelines:\n  default:\n    - step:\n        script: [make]\n")["valid"]


def test_validation_reports_lines_and_messages():
    content = "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    needs: deploy\n    steps:\n      - uses: actions/checkout\n  deploy:\n    runs-on: ubuntu-latest\n    needs: build\n    steps:\n      - run: make\n        uses: x@v1\n"
    problems = validate("github", content)["problems"]
    messages = {(p["line"], p["message"].split(" :")[0].split(" «")[0]) for p in problems}
    assert (7, "Version manquante pour l'action") in messages
    assert (13 - 1, "Une étape doit contenir soit") in messages
    assert any("circulaires" in p["message"] for p in problems)


def test_validation_yaml_syntax_error_position():
    result = validate("gitlab", "test:\n  script:\n\t- make\n")
    assert result["valid"] is False and result["problems"][0]["line"] == 3
    assert "tabulation" in result["problems"][0]["message"]


def test_validation_warns_instead_of_failing_with_includes():
    content = "include: [{local: common.yml}]\ntest:\n  extends: .base\n  needs: [build]\n"
    result = validate("gitlab", content)
    assert result["valid"] is True and result["warnings"] == 2


# ---------------------------------------------------------------------------
# Édition dans le clone local
# ---------------------------------------------------------------------------


def test_read_save_and_conflict(repo):
    service, work = repo["service"], repo["work"]
    file = service.read_ci_file(KEY, CI)
    assert file["content"] == VALID and file["tracked"] and file["branch"] == "main"

    saved = service.save_ci_file(KEY, CI, VALID.replace("make test", "make ci"), file["hash"])
    assert (work / CI).read_text().endswith("make ci\n")
    ci_state = {f["path"]: f["state"] for f in saved["status"]["ci_files"]}
    assert ci_state[CI] == "uncommitted"

    # Modification faite dans un autre éditeur entre-temps.
    (work / CI).write_text("modifié ailleurs\n")
    with pytest.raises(FileConflictError):
        service.save_ci_file(KEY, CI, "ma version", saved["hash"])
    overwritten = service.save_ci_file(KEY, CI, "ma version", saved["hash"], overwrite=True)
    assert (work / CI).read_text() == "ma version\n" and overwritten["hash"]

    with pytest.raises(EasyCIError):
        service.read_ci_file(KEY, "notes.txt")
    with pytest.raises(EasyCIError):
        service.save_ci_file(KEY, ".github/workflows/../../evil.yml", "x", None)


def test_new_workflow_and_discard(repo):
    service, work = repo["service"], repo["work"]
    path = ".github/workflows/release.yaml"
    assert service.read_ci_file(KEY, path)["exists"] is False
    service.save_ci_file(KEY, path, VALID, None)
    with pytest.raises(FileConflictError):
        service.save_ci_file(KEY, path, VALID, None)  # ne pas écraser un fichier créé entre-temps
    states = {f["path"]: f["state"] for f in service.status(KEY)["ci_files"]}
    assert states[path] == "untracked"

    service.discard_ci_file(KEY, path)
    assert not (work / path).exists()

    service.save_ci_file(KEY, CI, "name: changé\n", service.read_ci_file(KEY, CI)["hash"])
    service.discard_ci_file(KEY, CI)
    assert (work / CI).read_text() == VALID


def test_commit_on_new_branch_then_push(repo):
    service, work, bare = repo["service"], repo["work"], repo["bare"]
    suggestion = service.branch_suggestion(KEY, CI)
    assert suggestion["suggested"].startswith("ci/ci-") and suggestion["on_default_branch"] is True and suggestion["default_branch"] == "main"

    service.save_ci_file(KEY, CI, VALID.replace("make test", "make ci"), service.read_ci_file(KEY, CI)["hash"])
    with pytest.raises(EasyCIError, match="nom de branche"):
        service.commit_ci(KEY, [CI], "ci: cible ci", "branche invalide..")
    with pytest.raises(EasyCIError, match="Aucune modification"):
        service.commit_ci(KEY, [".github/workflows/other.yml"], "x", None)

    result = service.commit_ci(KEY, [CI], "ci: cible ci", suggestion["suggested"])
    status = result["status"]
    assert status["branch"] == suggestion["suggested"] and status["ahead"] == 0 and status["upstream"] is None
    assert git(work, "log", "-1", "--format=%s").strip() == "ci: cible ci"
    # Le fichier hors CI non commité reste en l'état.
    assert "notes.txt" in {c["path"] for c in status["changes"]}
    assert git(work, "show", "--name-only", "--format=", "HEAD").split() == [CI]

    service.save_ci_file(KEY, CI, VALID + "# encore\n", service.read_ci_file(KEY, CI)["hash"])
    with pytest.raises(EasyCIError, match="existe déjà"):
        service.commit_ci(KEY, [CI], "x", suggestion["suggested"])


def test_push_uses_remote_matching_repository(repo, tmp_path):
    service, work, bare = repo["service"], repo["work"], repo["bare"]
    # Le remote « github » pointe vers l'URL du dépôt : on le fait pointer vers le dépôt nu pour pouvoir pousser.
    git(work, "remote", "set-url", "--push", "github", str(bare))
    service.save_ci_file(KEY, CI, VALID + "# fin\n", service.read_ci_file(KEY, CI)["hash"])
    service.commit_ci(KEY, [CI], "ci: commentaire", "ci/commentaire")
    pushed = service.push(KEY)
    assert pushed["remote"] == "github" and pushed["branch"] == "ci/commentaire"
    assert "ci/commentaire" in git(bare, "branch", "--list")
    assert pushed["status"]["upstream"] == "github/ci/commentaire" and pushed["status"]["ahead"] == 0


def test_commit_requires_git_identity(repo):
    service, work = repo["service"], repo["work"]
    git(work, "config", "--unset", "user.name")
    service.save_ci_file(KEY, CI, VALID + "# x\n", service.read_ci_file(KEY, CI)["hash"])
    with pytest.raises(EasyCIError, match="Identité Git"):
        service.commit_ci(KEY, [CI], "ci", None)


# ---------------------------------------------------------------------------
# Pull requests
# ---------------------------------------------------------------------------


def router(routes, calls):
    def handler(request):
        calls.append(request)
        key = f"{request.method} {request.url.raw_path.decode().split('?')[0]}"
        route = routes.get(key)
        if route is None:
            return httpx.Response(404, json={"message": "Not Found"})
        return route(request) if callable(route) else route

    return handler


def test_github_pull_requests():
    calls = []
    routes = {
        "GET /repos/acme/app/pulls": httpx.Response(200, json=[]),
        "POST /repos/acme/app/pulls": httpx.Response(201, json={"number": 7, "title": "ci", "html_url": "https://github.com/acme/app/pull/7", "state": "open", "draft": True, "head": {"ref": "ci/x"}, "base": {"ref": "main"}}),
    }
    service = GitHubService(GitHubClient("t", transport=httpx.MockTransport(router(routes, calls))))
    assert service.find_pull_request("acme/app", "ci/x") is None
    assert calls[0].url.params["head"] == "acme:ci/x"
    pull = service.create_pull_request("acme/app", "ci/x", "main", "ci", "corps", draft=True)
    assert pull["url"].endswith("/pull/7") and pull["draft"] is True
    assert json.loads(calls[1].content) == {"title": "ci", "head": "ci/x", "base": "main", "body": "corps", "draft": True}


def test_github_validation_error_details():
    routes = {"POST /repos/acme/app/pulls": httpx.Response(422, json={"message": "Validation Failed", "errors": [{"message": "No commits between main and ci/x"}]})}
    service = GitHubService(GitHubClient("t", transport=httpx.MockTransport(router(routes, []))))
    with pytest.raises(EasyCIError, match="No commits between main and ci/x"):
        service.create_pull_request("acme/app", "ci/x", "main", "ci", "")


def test_gitlab_merge_request_and_lint():
    calls = []
    project = {"id": 9, "path_with_namespace": "grp/app", "path": "app", "default_branch": "main", "web_url": "https://gitlab.com/grp/app"}
    routes = {
        "GET /api/v4/projects/grp%2Fapp": httpx.Response(200, json=project),
        "GET /api/v4/projects/9/merge_requests": httpx.Response(200, json=[]),
        "POST /api/v4/projects/9/merge_requests": httpx.Response(201, json={"iid": 3, "title": "Draft: ci", "web_url": "https://gitlab.com/grp/app/-/merge_requests/3", "state": "opened", "draft": True, "source_branch": "ci/x", "target_branch": "main"}),
        "POST /api/v4/projects/9/ci/lint": httpx.Response(200, json={"valid": False, "errors": ["jobs:test config should implement a script: or a trigger: keyword"], "warnings": []}),
    }
    service = GitLabService(GitLabClient("t", transport=httpx.MockTransport(router(routes, calls))))
    assert service.find_pull_request("grp/app", "ci/x") is None
    mr = service.create_pull_request("grp/app", "ci/x", "main", "ci", "corps", draft=True)
    assert mr["label"] == "Merge request" and mr["number"] == 3
    body = json.loads(next(c for c in calls if c.url.path.endswith("/merge_requests") and c.method == "POST").content)
    assert body["title"] == "Draft: ci" and body["source_branch"] == "ci/x" and body["target_branch"] == "main"
    lint = service.lint_ci("grp/app", "test: {}")
    assert lint["valid"] is False and "script" in lint["errors"][0]


def test_bitbucket_pull_request():
    calls = []
    routes = {
        "GET /2.0/repositories/team/app/pullrequests": httpx.Response(200, json={"values": [{"id": 5, "title": "ci", "state": "OPEN", "links": {"html": {"href": "https://bitbucket.org/team/app/pull-requests/5"}}, "source": {"branch": {"name": "ci/x"}}, "destination": {"branch": {"name": "main"}}}]}),
    }
    service = BitbucketService(BitbucketClient(access_token="t", transport=httpx.MockTransport(router(routes, calls))))
    pull = service.find_pull_request("team/app", "ci/x")
    assert pull["number"] == 5 and pull["state"] == "open"
    assert calls[0].url.params["q"] == 'source.branch.name="ci/x" AND state="OPEN"'


def test_api_pull_request_flow_in_demo(tmp_path):
    class NoCredentials:
        def load(self, provider):
            return None

        def save(self, provider, credentials):
            return True

        def clear(self, provider):
            pass

    api = Api(NoCredentials(), SettingsStore(tmp_path / "s.json"))
    api.call("start_demo")
    key = "github:acme/storefront"
    path = ".github/workflows/ci.yml"

    file = api.call("read_ci_file", {"key": key, "path": path})["data"]
    edited = file["content"].replace("npm run lint", "npm run lint -- --max-warnings=0")
    assert api.call("validate_ci", {"provider": "github", "content": edited})["data"]["valid"] is True
    saved = api.call("save_ci_file", {"key": key, "path": path, "content": edited, "expected_hash": file["hash"]})["data"]
    assert {f["path"]: f["state"] for f in saved["status"]["ci_files"]}[path] == "uncommitted"

    early = api.call("create_pull_request", {"key": key, "title": "ci"})
    assert early["ok"] is False  # branche principale / pas encore envoyée

    commit = api.call("commit_ci", {"key": key, "paths": [path], "message": "ci: lint strict", "new_branch": "ci/lint-strict"})["data"]
    assert commit["status"]["branch"] == "ci/lint-strict"
    not_pushed = api.call("create_pull_request", {"key": key, "title": "ci: lint strict"})
    assert not_pushed["ok"] is False and "Envoyez" in not_pushed["error"]["message"]

    api.call("push_local_branch", {"key": key})
    publication = api.call("get_publication", {"key": key})["data"]
    assert publication["pushed"] is True and publication["pull_request"] is None and publication["default_branch"] == "main"

    pull = api.call("create_pull_request", {"key": key, "title": "ci: lint strict", "body": "détails"})["data"]
    assert pull["url"].startswith("https://github.com/acme/storefront/pull/") and pull["already_existed"] is False
    again = api.call("create_pull_request", {"key": key, "title": "ci: lint strict"})["data"]
    assert again["already_existed"] is True
    assert api.call("get_publication", {"key": key})["data"]["pull_request"]["number"] == pull["number"]

    lint = api.call("lint_ci_remote", {"key": "gitlab:platform/backend/billing-service", "content": "test:\n  stage: nope\n  script: [x]\n"})["data"]
    assert lint["valid"] is False
