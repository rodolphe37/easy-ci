import subprocess
from pathlib import Path

import pytest

from easy_ci.errors import EasyCIError, LinkMismatchError
from easy_ci.local import service as local_service
from easy_ci.local.remotes import clone_urls, match_remote, parse_remote_url
from easy_ci.local.service import LocalProjectsService
from easy_ci.storage import SettingsStore

KEY = "github:acme/app"
REMOTE_URL = "git@github.com:acme/app.git"


@pytest.fixture(autouse=True)
def isolated_git(monkeypatch, tmp_path):
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(tmp_path / "gitconfig"))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    for var, value in {"GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "t@example.org", "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "t@example.org"}.items():
        monkeypatch.setenv(var, value)


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def commit_file(repo, path, content, message):
    file = Path(repo) / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(content)
    git(repo, "add", path)
    git(repo, "commit", "-q", "-m", message)


@pytest.fixture
def workspace(tmp_path):
    """Un dépôt « distant » nu, un clone de travail lié à github:acme/app et un second clone (collègue)."""
    bare = tmp_path / "remote.git"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(bare))

    seed = tmp_path / "seed"
    git(tmp_path, "clone", "-q", str(bare), str(seed))
    commit_file(seed, ".github/workflows/ci.yml", "name: CI\non: push\n", "ci")
    commit_file(seed, "README.md", "hello\n", "readme")
    git(seed, "push", "-q", "origin", "main")

    root = tmp_path / "dev"
    (root / "clients" / "node_modules" / "trap").mkdir(parents=True)
    work = root / "clients" / "app"
    git(tmp_path, "clone", "-q", str(bare), str(work))
    git(work, "remote", "add", "github", REMOTE_URL)
    git(root / "clients" / "node_modules" / "trap", "init", "-q")  # ignoré : node_modules

    other = tmp_path / "unrelated"
    (root / "notes").mkdir()
    git(root / "notes", "init", "-q")

    settings = SettingsStore(tmp_path / "settings.json")
    service = LocalProjectsService(settings)
    return {"bare": bare, "seed": seed, "work": work, "root": root, "service": service, "settings": settings, "other": other}


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://github.com/acme/app.git", ("github", "acme/app")),
        ("git@github.com:acme/app.git", ("github", "acme/app")),
        ("ssh://git@ssh.github.com:443/acme/app.git", ("github", "acme/app")),
        ("https://user@bitbucket.org/team/repo.git", ("bitbucket", "team/repo")),
        ("git@gitlab.com:group/sub/project.git", ("gitlab", "group/sub/project")),
        ("https://gitlab.example.org/team/api", ("gitlab", "team/api")),
        ("https://git.unknown.org/a/b.git", None),
        ("/Users/me/repos/app.git", None),
        ("../app", None),
    ],
)
def test_match_remote(url, expected):
    assert match_remote(url, {"gitlab": ("https://gitlab.example.org",)}) == expected


def test_parse_and_clone_urls():
    assert parse_remote_url("git@host.io:a/b.git") == ("host.io", "a/b")
    assert clone_urls("gitlab", "g/s/p", "https://gitlab.example.org") == {
        "https": "https://gitlab.example.org/g/s/p.git",
        "ssh": "git@gitlab.example.org:g/s/p.git",
    }
    assert clone_urls("bitbucket", "w/r")["ssh"] == "git@bitbucket.org:w/r.git"
    assert clone_urls("github", "acme/app")["https"] == "https://github.com/acme/app.git"


def test_clone_urls_on_a_self_hosted_instance():
    """L'instance fournie s'applique quel que soit le fournisseur, pas seulement GitLab."""
    assert clone_urls("gitea", "org/app", "https://git.exemple.fr/") == {
        "https": "https://git.exemple.fr/org/app.git",
        "ssh": "git@git.exemple.fr:org/app.git",
    }


def test_match_remote_on_a_self_hosted_instance():
    """Un fournisseur auto-hébergé se déclare dans le tableau des hôtes, sans code dédié."""
    hosts = {"gitea": ("https://git.exemple.fr",)}
    assert match_remote("git@git.exemple.fr:org/app.git", hosts) == ("gitea", "org/app")
    assert match_remote("https://git.exemple.fr/org/app.git", hosts) == ("gitea", "org/app")
    assert match_remote("https://git.exemple.fr/org/app.git") is None


def test_scan_discovers_clones_and_skips_heavy_folders(workspace):
    service = workspace["service"]
    overview = service.add_root(str(workspace["root"]))
    assert [p["key"] for p in overview["projects"]] == [KEY]
    project = overview["projects"][0]
    assert Path(project["path"]) == workspace["work"].resolve() and project["source"] == "scan"
    assert [Path(u["path"]).name for u in overview["unmatched"]] == ["notes"]
    assert overview["roots"][0]["exists"] is True

    with pytest.raises(EasyCIError):
        service.add_root(str(workspace["root"] / "missing"))


def test_status_tracks_branch_changes_and_ci_files(workspace):
    service, work, seed = workspace["service"], workspace["work"], workspace["seed"]
    service.add_root(str(workspace["root"]))

    status = service.status(KEY)
    assert status["linked"] and status["branch"] == "main" and status["upstream"] == "origin/main"
    assert (status["ahead"], status["behind"], status["dirty"]) == (0, 0, False)
    assert status["remote_matches"] is True
    assert status["ci_files"] == [{"path": ".github/workflows/ci.yml", "state": "synced", "local": True, "remote": True}]

    # Un collègue pousse une modification du workflow et un nouveau workflow.
    commit_file(seed, ".github/workflows/ci.yml", "name: CI\non: [push, pull_request]\n", "ci: PR")
    commit_file(seed, ".github/workflows/deploy.yml", "name: Deploy\non: push\n", "deploy")
    git(seed, "push", "-q", "origin", "main")
    result = service.sync(KEY)
    assert result["pulled"] is False
    status = result["status"]
    assert status["behind"] == 2 and status["last_fetch_at"]
    assert {f["path"]: f["state"] for f in status["ci_files"]} == {".github/workflows/ci.yml": "outdated", ".github/workflows/deploy.yml": "outdated"}
    deploy = next(f for f in status["ci_files"] if f["path"].endswith("deploy.yml"))
    assert deploy["local"] is False and deploy["remote"] is True

    # Mise à jour en avance rapide.
    result = service.sync(KEY, pull=True)
    assert result["pulled"] is True and result["status"]["behind"] == 0
    assert {f["state"] for f in result["status"]["ci_files"]} == {"synced"}

    # Modification locale non commitée, puis commitée mais non poussée.
    (work / ".github/workflows/ci.yml").write_text("name: CI local\n")
    status = service.status(KEY)
    assert status["dirty"] and status["changes"] == [{"path": ".github/workflows/ci.yml", "status": "modified"}]
    assert status["ci_files"][0]["state"] == "uncommitted"
    diff = service.ci_diff(KEY, ".github/workflows/ci.yml")
    assert "-name: CI" in diff["diff"] and "+name: CI local" in diff["diff"] and diff["compare_ref"] == "origin/main"

    skipped = service.sync(KEY, pull=True)
    assert skipped["pulled"] is False and skipped["skipped_reason"] == "dirty"  # jamais de pull sur une copie modifiée

    git(work, "commit", "-q", "-am", "ci local")
    status = service.status(KEY)
    assert status["ahead"] == 1 and {f["path"]: f["state"] for f in status["ci_files"]}[".github/workflows/ci.yml"] == "unpushed"

    with pytest.raises(EasyCIError):
        service.ci_diff(KEY, "README.md")
    with pytest.raises(EasyCIError):
        service.ci_diff(KEY, ".github/workflows/../../etc.yml")


def test_pull_is_skipped_when_dirty(workspace):
    service, work, seed = workspace["service"], workspace["work"], workspace["seed"]
    service.add_root(str(workspace["root"]))
    commit_file(seed, "README.md", "update\n", "readme")
    git(seed, "push", "-q", "origin", "main")
    (work / "notes.txt").write_text("brouillon")
    result = service.sync(KEY, pull=True)
    assert result["pulled"] is False and result["skipped_reason"] == "dirty"
    assert result["status"]["behind"] == 1


def test_link_unlink_and_mismatch(workspace, tmp_path):
    service, work = workspace["service"], workspace["work"]
    with pytest.raises(LinkMismatchError):
        service.link("github:acme/other", str(work))
    with pytest.raises(EasyCIError, match="pas un dépôt Git"):
        service.link(KEY, str(tmp_path))

    status = service.link(KEY, str(work / ".github"))  # un sous-dossier est ramené à la racine du dépôt
    assert Path(status["path"]) == work.resolve()
    assert service.overview()["projects"][0]["source"] == "manual"

    forced = service.link("github:acme/other", str(work), force=True)
    assert forced["remote_matches"] is False

    service.add_root(str(workspace["root"]))
    service.unlink(KEY)
    keys = [p["key"] for p in service.overview()["projects"]]
    assert KEY not in keys  # le clone détecté n'est plus proposé après une déliaison volontaire
    assert service.status(KEY) == {"key": KEY, "linked": False}


def test_clone_links_the_new_folder(workspace, tmp_path, monkeypatch):
    service = workspace["service"]
    monkeypatch.setattr(local_service, "clone_urls", lambda *args: {"https": str(workspace["bare"]), "ssh": ""})
    parent = tmp_path / "clones"
    parent.mkdir()
    status = service.clone(KEY, str(parent))
    assert Path(status["path"]) == (parent / "app").resolve() and status["branch"] == "main"
    with pytest.raises(EasyCIError, match="existe déjà"):
        service.clone(KEY, str(parent))


def test_deleted_folder_is_reported(workspace):
    service, work = workspace["service"], workspace["work"]
    service.link(KEY, str(work))
    # Déplacer plutôt que supprimer : sous Windows, les objets Git en lecture seule bloquent shutil.rmtree.
    work.rename(work.with_name("app-deplace"))
    status = service.status(KEY)
    assert status["exists"] is False and "n'existe plus" in status["error"]
    with pytest.raises(EasyCIError):
        service.sync(KEY)


def test_api_routes_demo_local_projects(tmp_path):
    from easy_ci.api import Api

    class NoCredentials:
        def load(self, provider):
            return None

        def save(self, provider, credentials):
            return True

        def clear(self, provider):
            pass

    api = Api(NoCredentials(), SettingsStore(tmp_path / "s.json"))
    real = api.call("local_overview")["data"]
    assert real["projects"] == [] and "demo" not in real
    api.call("start_demo")
    overview = api.call("local_overview")["data"]
    assert overview["demo"] is True and len(overview["projects"]) == 4
    status = api.call("get_local_status", {"key": "github:acme/storefront"})["data"]
    assert status["behind"] == 2
    synced = api.call("sync_local_project", {"key": "github:acme/storefront", "pull": True})["data"]
    assert synced["pulled"] is True and synced["status"]["behind"] == 0
    diff = api.call("get_local_ci_diff", {"key": "gitlab:platform/backend/billing-service", "path": ".gitlab-ci.yml"})["data"]
    assert "+  cache:" in diff["diff"]
    assert api.call("open_local_project", {"key": "github:acme/storefront", "target": "folder"})["ok"] is False


def test_settings_survive_an_interrupted_write(tmp_path):
    """Une coupure pendant l'écriture ne doit plus réinitialiser toutes les préférences."""
    from easy_ci.storage import SettingsStore

    store = SettingsStore(tmp_path / "settings.json")
    store.update({"favorites": ["github:acme/app"], "local_roots": [str(tmp_path)], "theme": "dark"})

    # L'écriture passe par un fichier temporaire : c'est lui qui serait tronqué, jamais la cible.
    leftovers = list(tmp_path.glob(".settings.json.*"))
    assert not leftovers, f"fichier temporaire laissé derrière : {leftovers}"
    (tmp_path / ".settings.json.easy-ci.tmp").write_text('{"favorites": ["gith')

    reloaded = store.load()
    assert reloaded["favorites"] == ["github:acme/app"]
    assert reloaded["local_roots"] == [str(tmp_path)]
    assert reloaded["theme"] == "dark"
