import json
import time

import httpx
import pytest

from easy_ci.api import Api
from easy_ci.bitbucket.service import BitbucketClient, BitbucketService
from easy_ci.demo import DemoService
from easy_ci.errors import EasyCIError
from easy_ci.github.client import GitHubClient
from easy_ci.github.service import GitHubService
from easy_ci.gitlab.service import GitLabClient, GitLabService
from easy_ci.providers import PROVIDERS, provider_for_host
from easy_ci.refs import parse_repository_reference
from easy_ci.storage import SettingsStore


class MemoryCredentialStore:
    def __init__(self, **stored):
        self.stored = dict(stored)

    def load(self, provider):
        return self.stored.get(provider)

    def save(self, provider, credentials):
        self.stored[provider] = credentials
        return True

    def clear(self, provider):
        self.stored.pop(provider, None)


def github_handler(valid_token="good", repos=None, extra=None):
    def handler(request):
        if request.headers["Authorization"] != f"Bearer {valid_token}":
            return httpx.Response(401, json={"message": "Bad credentials"})
        path = request.url.path
        if path == "/user":
            return httpx.Response(200, json={"login": "marie", "name": "Marie"})
        if path == "/user/repos":
            return httpx.Response(200, json=repos or [])
        for full_name, payload in (extra or {}).items():
            if path.lower() == f"/repos/{full_name}".lower():
                return httpx.Response(200, json=payload)
        return httpx.Response(404, json={"message": "Not Found"})

    return handler


def gitlab_handler(request):
    if request.headers.get("PRIVATE-TOKEN") != "glpat-good":
        return httpx.Response(401, json={"message": "401 Unauthorized"})
    if request.url.path == "/api/v4/user":
        return httpx.Response(200, json={"username": "marie.gl", "name": "Marie GL", "avatar_url": None, "web_url": "https://gitlab.example.org/marie.gl"})
    return httpx.Response(404, json={"message": "404 Not found"})


def factories(github=None):
    return {
        "github": lambda c: GitHubService(GitHubClient(c["token"], transport=httpx.MockTransport(github or github_handler()))),
        "gitlab": lambda c: GitLabService(GitLabClient(c["token"], host=c["host"], transport=httpx.MockTransport(gitlab_handler))),
        "bitbucket": lambda c: BitbucketService(BitbucketClient(email=c.get("email"), api_token=c.get("api_token"), access_token=c.get("access_token"), transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"display_name": "Marie BB", "nickname": "mariebb"})))),
    }


@pytest.fixture
def api(tmp_path):
    return Api(MemoryCredentialStore(), SettingsStore(tmp_path / "settings.json"), factories())


def test_unknown_method_and_unauthenticated(api):
    assert api.call("nope")["error"]["code"] == "unknown_method"
    error = api.call("list_repositories", {"provider": "gitlab"})["error"]
    assert error["code"] == "not_authenticated" and "GitLab" in error["message"]


def test_connect_several_accounts(api):
    bad = api.call("login", {"token": "bad"})
    assert bad["ok"] is False and bad["error"]["code"] == "unauthorized"

    session = api.call("login", {"token": " good "})["data"]
    assert session["mode"] == "live" and [a["provider"] for a in session["accounts"]] == ["github"]

    missing = api.call("connect_account", {"provider": "bitbucket", "credentials": {"email": "marie@example.org"}})
    assert missing["ok"] is False and "API token" in missing["error"]["message"]

    session = api.call("connect_account", {"provider": "gitlab", "credentials": {"token": "glpat-good", "host": "gitlab.example.org/"}})["data"]
    session = api.call("connect_account", {"provider": "bitbucket", "credentials": {"email": "marie@example.org", "api_token": "ATATT"}})["data"]
    accounts = {a["provider"]: a for a in session["accounts"]}
    assert list(accounts) == ["github", "gitlab", "bitbucket"]
    assert accounts["gitlab"]["host"] == "https://gitlab.example.org"
    assert accounts["gitlab"]["user"]["login"] == "marie.gl"
    assert api._credentials.stored["gitlab"] == {"token": "glpat-good", "host": "https://gitlab.example.org"}
    assert session["providers"]["gitlab"]["capabilities"]["live_logs"] is True

    session = api.call("disconnect_account", {"provider": "gitlab"})["data"]
    assert [a["provider"] for a in session["accounts"]] == ["github", "bitbucket"]
    assert "gitlab" not in api._credentials.stored

    assert api.call("logout")["data"]["authenticated"] is False
    assert api._credentials.stored == {}


def test_sessions_are_restored_and_revoked_credentials_cleared(tmp_path):
    store = MemoryCredentialStore(github={"token": "good"}, gitlab={"token": "revoked", "host": "https://gitlab.example.org"})
    api = Api(store, SettingsStore(tmp_path / "s.json"), factories())
    session = api.call("get_session")["data"]
    assert [a["provider"] for a in session["accounts"]] == ["github"]
    assert session["restore_errors"][0]["provider"] == "gitlab"
    assert "gitlab" not in store.stored


def test_auth_error_during_session_disconnects_only_that_provider(tmp_path):
    tokens = {"current": "good"}

    def github(request):
        return github_handler(valid_token=tokens["current"])(request)

    api = Api(MemoryCredentialStore(), SettingsStore(tmp_path / "s.json"), factories(github))
    api.call("login", {"token": "good"})
    api.call("connect_account", {"provider": "gitlab", "credentials": {"token": "glpat-good"}})
    tokens["current"] = "rotated"  # token révoqué côté GitHub

    error = api.call("scan_repository", {"provider": "github", "full_name": "acme/app"})["error"]
    assert error["code"] == "unauthorized" and error["provider"] == "github"
    assert [a["provider"] for a in api.call("get_session")["data"]["accounts"]] == ["gitlab"]


def test_settings_roundtrip_and_legacy_keys(api, tmp_path):
    (tmp_path / "settings.json").write_text(json.dumps({"favorites": ["acme/app"], "hidden_repositories": ["gitlab:grp/proj"]}))
    settings = api.call("get_settings")["data"]
    assert settings["favorites"] == ["github:acme/app"]  # anciennes préférences GitHub migrées
    assert settings["hidden_repositories"] == ["gitlab:grp/proj"]
    updated = api.call("update_settings", {"changes": {"theme": "dark", "unknown": 1}})["data"]
    assert updated["theme"] == "dark" and "unknown" not in updated


def test_open_external_rejects_non_web_urls(api):
    assert api.call("open_external", {"url": "file:///etc/passwd"})["ok"] is False


@pytest.mark.parametrize(
    ("reference", "provider", "expected"),
    [
        ("acme/app", None, ("github", "acme/app")),
        (" acme/app/ ", "bitbucket", ("bitbucket", "acme/app")),
        ("https://github.com/acme/app/actions?query=x", None, ("github", "acme/app")),
        ("git@github.com:acme/app.git", None, ("github", "acme/app")),
        ("https://gitlab.com/group/sub/project/-/pipelines", None, ("gitlab", "group/sub/project")),
        ("group/sub/project", "gitlab", ("gitlab", "group/sub/project")),
        ("git@gitlab.example.org:team/api.git", None, ("gitlab", "team/api")),
        # Miroirs SSH des plateformes, déjà reconnus côté remotes locaux.
        ("git@ssh.github.com:acme/app.git", None, ("github", "acme/app")),
        ("git@altssh.bitbucket.org:workspace/repo.git", None, ("bitbucket", "workspace/repo")),
        # URL « ssh:// » : le port ne doit pas être pris pour un morceau du chemin.
        ("ssh://git@github.com/acme/app.git", None, ("github", "acme/app")),
        ("ssh://git@github.com:22/acme/app.git", None, ("github", "acme/app")),
        ("ssh://git@ssh.github.com:443/acme/app.git", None, ("github", "acme/app")),
        ("ssh://git@gitlab.com:22/group/sub/project.git", None, ("gitlab", "group/sub/project")),
        ("ssh://git@bitbucket.org:7999/workspace/repo.git", None, ("bitbucket", "workspace/repo")),
        # Cas courant d'une instance auto-hébergée : SSH sur un port dédié.
        ("ssh://git@gitlab.example.org:2222/team/api.git", None, ("gitlab", "team/api")),
        ("https://bitbucket.org/workspace/repo/src/main/", None, ("bitbucket", "workspace/repo")),
    ],
)
def test_parse_repository_reference(reference, provider, expected):
    assert parse_repository_reference(reference, provider, {"gitlab": ("https://gitlab.example.org",)}) == expected


@pytest.mark.parametrize("reference", ["pas un dépôt", "../..", "https://unknown.example/a/b", "a/b/c"])
def test_parse_repository_reference_rejects_garbage(reference):
    with pytest.raises(EasyCIError):
        parse_repository_reference(reference)


@pytest.mark.parametrize(
    ("host", "hosts", "expected"),
    [
        ("github.com", None, "github"),
        ("ssh.github.com", None, "github"),
        ("www.gitlab.com", None, "gitlab"),
        ("altssh.bitbucket.org", None, "bitbucket"),
        ("git.exemple.fr", None, None),
        ("gitlab.exemple.fr", {"gitlab": ("https://gitlab.exemple.fr",)}, "gitlab"),
        # L'adresse publique prime sur une instance auto-hébergée mal déclarée.
        ("github.com", {"gitlab": ("https://github.com",)}, "github"),
        # Instances déclarées sans schéma, avec « www. » ou en majuscules.
        ("gitlab.exemple.fr", {"gitlab": ("GitLab.Exemple.fr",)}, "gitlab"),
        ("gitlab.exemple.fr", {"gitlab": ("https://www.gitlab.exemple.fr/",)}, "gitlab"),
        # Le tableau n'est pas réservé à GitLab : tout fournisseur auto-hébergé s'y déclare.
        ("git.exemple.fr", {"gitea": ("https://git.exemple.fr",)}, "gitea"),
    ],
)
def test_provider_for_host(host, hosts, expected):
    assert provider_for_host(host, hosts) == expected


def test_add_and_remove_repository(tmp_path):
    listed = [{"id": 1, "full_name": "acme/listed", "name": "listed", "owner": {"login": "acme"}}]
    extra = {"Other/Tool": {"id": 2, "full_name": "Other/Tool", "name": "Tool", "owner": {"login": "Other"}}}
    api = Api(MemoryCredentialStore(github={"token": "good"}), SettingsStore(tmp_path / "s.json"), factories(github_handler(repos=listed, extra=extra)))
    api.call("get_session")
    api.call("update_settings", {"changes": {"hidden_repositories": ["github:Other/Tool"]}})

    added = api.call("add_repository", {"reference": "https://github.com/other/tool"})["data"]
    assert added["repository"]["key"] == "github:Other/Tool"
    assert added["settings"]["added_repositories"] == ["github:Other/Tool"]
    assert added["settings"]["hidden_repositories"] == []  # ajouter un dépôt le rend à nouveau visible

    repos = api.call("list_repositories", {"provider": "github"})["data"]
    assert [(r["full_name"], r.get("added_manually", False)) for r in repos] == [("acme/listed", False), ("Other/Tool", True)]

    missing = api.call("add_repository", {"reference": "acme/missing"})
    assert missing["ok"] is False and "introuvable" in missing["error"]["message"]
    not_connected = api.call("add_repository", {"reference": "https://gitlab.com/grp/proj"})
    assert not_connected["error"]["code"] == "not_authenticated"

    api.call("remove_repository", {"key": "github:other/tool"})
    assert [r["full_name"] for r in api.call("list_repositories", {"provider": "github"})["data"]] == ["acme/listed"]


def test_demo_mode_end_to_end(api):
    session = api.call("start_demo")["data"]
    assert session["mode"] == "demo" and len(session["accounts"]) == 3

    by_provider = {p: api.call("list_repositories", {"provider": p})["data"] for p in ("github", "gitlab", "bitbucket")}
    assert {r["full_name"] for r in by_provider["gitlab"]} == {"platform/backend/billing-service", "platform/frontend/customer-portal"}
    assert all(r["provider"] == "bitbucket" for r in by_provider["bitbucket"])

    scans = {
        r["key"]: api.call("scan_repository", {"provider": p, "full_name": r["full_name"]})["data"]
        for p, repos in by_provider.items()
        for r in repos
    }
    assert scans["github:acme/payments-api"]["state"] == "failure"
    assert scans["github:acme/handbook"]["has_ci"] is False
    assert scans["gitlab:platform/frontend/customer-portal"]["state"] == "failure"

    failed = scans["github:acme/payments-api"]["workflows"][0]["latest_run"]
    detail = api.call("get_run", {"provider": "github", "full_name": "acme/payments-api", "run_id": failed["id"]})["data"]
    assert {job["name"]: job["state"] for job in detail["jobs"]} == {"Lint": "success", "Test": "failure", "Build": "skipped"}
    assert detail["capabilities"]["steps"] is True

    test_job = next(j for j in detail["jobs"] if j["name"] == "Test")
    log = api.call("get_job_log", {"provider": "github", "full_name": "acme/payments-api", "job_id": test_job["id"]})["data"]
    assert log["available"] and log["errors"] and log["complete"]

    portal = scans["gitlab:platform/frontend/customer-portal"]["workflows"][0]
    assert portal["path"] == ".gitlab-ci.yml"
    portal_run = api.call("get_run", {"provider": "gitlab", "full_name": "platform/frontend/customer-portal", "run_id": portal["latest_run"]["id"]})["data"]
    assert [(j["name"], j["stage"], j["state"]) for j in portal_run["jobs"]] == [("unit-tests", "test", "failure"), ("e2e", "test", "success"), ("pages", "deploy", "skipped")]
    gl_log = api.call("get_job_log", {"provider": "gitlab", "full_name": "platform/frontend/customer-portal", "job_id": portal_run["jobs"][0]["id"]})["data"]
    assert gl_log["groups"][0]["collapsed"] is False and gl_log["excerpts"]

    file = api.call("get_workflow_file", {"provider": "gitlab", "full_name": "platform/frontend/customer-portal", "path": ".gitlab-ci.yml"})["data"]
    assert file["summary"]["stages"] == ["test", "deploy"]

    json.dumps(scans)  # tout doit être sérialisable


def test_demo_live_logs_for_gitlab_and_rerun_creates_new_pipeline():
    started = time.time()
    demo = DemoService(now=started)
    billing = "platform/backend/billing-service"
    latest = demo._workflows[billing][0].runs[-1]

    run, jobs = demo._materialize(latest, started)
    assert run["state"] == "running"
    running_job = next(j for j in jobs if j["state"] == "running")
    live = demo.get_job_log(billing, running_job["id"])
    assert live["available"] is True and live["complete"] is False  # log disponible pendant l'exécution

    run, jobs = demo._materialize(latest, started + 3600)
    assert run["state"] == "success"  # l'échec autorisé du lint ne fait pas échouer le pipeline
    lint = next(j for j in jobs if j["name"] == "lint")
    assert lint["state"] == "neutral" and lint["allow_failure"] is True

    portal = "platform/frontend/customer-portal"
    failed = demo._workflows[portal][0].runs[-1]
    count = len(demo._workflows[portal][0].runs)
    result = demo.rerun_run(portal, str(failed.id))
    assert result["run_id"] != str(failed.id) and len(demo._workflows[portal][0].runs) == count + 1


def test_demo_github_rerun_and_cancel():
    started = time.time()
    demo = DemoService(now=started)
    ci = demo._workflows["acme/payments-api"][0].runs[-1]
    assert demo.rerun_run("acme/payments-api", str(ci.id)) == {"run_id": str(ci.id)}
    run, _ = demo._materialize(ci, time.time() + 3600)
    assert run["state"] == "success" and run["run_attempt"] == 2

    deploy = next(wf for wf in demo._workflows["acme/storefront"] if wf.name == "Deploy").runs[-1]
    demo.cancel_run("acme/storefront", str(deploy.id))
    run, jobs = demo._materialize(deploy, time.time() + 3600)
    assert run["state"] == "cancelled"
    assert {j["state"] for j in jobs} <= {"cancelled", "skipped"}


# -- Caches liés à un compte --------------------------------------------------


def _fill_caches(api):
    api._attempts_cache[("github", "acme/app", "1", 1)] = [{"name": "build"}]
    api._commits_cache[("github", "acme/app", "aaa", "bbb")] = {"commits": []}


def test_account_caches_are_keyed_by_provider_not_by_object_identity(api):
    """id() est une adresse mémoire, réutilisée après libération : elle ne peut pas identifier un compte."""
    api.call("connect_account", {"provider": "github", "credentials": {"token": "good"}})
    api.call("get_run_stats", {"provider": "github", "full_name": "acme/app"})
    assert all(isinstance(key[0], str) and key[0] in PROVIDERS for key in api._attempts_cache)


@pytest.mark.parametrize(
    "transition",
    [
        lambda api: api.call("disconnect_account", {"provider": "github"}),
        lambda api: api.call("logout"),
        lambda api: api.call("start_demo"),
        lambda api: api.call("connect_account", {"provider": "github", "credentials": {"token": "good"}}),
    ],
)
def test_account_caches_are_emptied_when_accounts_change(api, transition):
    api.call("connect_account", {"provider": "github", "credentials": {"token": "good"}})
    _fill_caches(api)
    transition(api)
    assert not api._attempts_cache and not api._commits_cache


def test_leaving_the_demo_also_empties_the_caches(api):
    api.call("start_demo")
    _fill_caches(api)
    api.call("logout")
    assert not api._attempts_cache and not api._commits_cache
