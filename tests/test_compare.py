import httpx
import pytest

from easy_ci.api import Api
from easy_ci.bitbucket.service import BitbucketClient, BitbucketService
from easy_ci.compare import MAX_COMMITS, build_comparison, commit_range, compare_jobs, is_ci_config, pick_baseline
from easy_ci.errors import NotFoundError
from easy_ci.github.client import GitHubClient
from easy_ci.github.service import GitHubService
from easy_ci.gitlab.service import GitLabClient, GitLabService
from easy_ci.storage import SettingsStore


def _run(run_id, state, created, sha="aaa", branch="main", duration=100):
    return {"id": str(run_id), "state": state, "created_at": created, "head_sha": sha, "branch": branch, "duration_s": duration, "workflow_id": "1"}


def _job(name, state="success", duration=60, allow_failure=False, steps=()):
    return {"id": f"j-{name}", "name": name, "stage": None, "state": state, "duration_s": duration, "allow_failure": allow_failure, "steps": list(steps)}


# ---------------------------------------------------------------------------
# Calcul
# ---------------------------------------------------------------------------


def test_pick_baseline_last_success_before_a_failure():
    head = _run(5, "failure", "2026-09-14T10:00:00Z")
    runs = [
        head,
        _run(6, "success", "2026-09-14T11:00:00Z"),  # plus récente : ignorée
        _run(4, "failure", "2026-09-14T09:00:00Z"),
        _run(3, "success", "2026-09-14T08:00:00Z"),
        _run(2, "success", "2026-09-14T07:00:00Z"),
    ]
    assert pick_baseline(head, runs)["id"] == "3"


def test_pick_baseline_previous_completed_run_for_a_success():
    head = _run(5, "success", "2026-09-14T10:00:00Z")
    runs = [_run(3, "success", "2026-09-14T08:00:00Z"), _run(4, "failure", "2026-09-14T09:00:00Z"), _run(2, "cancelled", "2026-09-14T09:30:00Z")]
    assert pick_baseline(head, runs)["id"] == "4"
    assert pick_baseline(head, []) is None


def test_compare_jobs_classifies_changes():
    base = [
        _job("lint"),
        _job("tests", duration=100),
        _job("build", duration=100),
        _job("e2e", "failure"),
        _job("deploy", "skipped"),
        _job("old-job"),
        _job("flaky", "failure"),
        _job("docs", "failure", allow_failure=True),
    ]
    head = [
        _job("lint", duration=62),
        _job("tests", "failure", steps=[{"name": "Checkout", "state": "success"}, {"name": "Run npm test", "state": "failure"}]),
        _job("build", duration=180),
        _job("e2e", "failure"),
        _job("deploy", "success"),
        _job("new-job"),
        _job("flaky", "success"),
        _job("docs", "failure", allow_failure=True),
    ]
    rows = {row["name"]: row for row in compare_jobs(base, head)}
    assert rows["tests"]["change"] == "broken"
    assert rows["tests"]["head"]["failed_step"] == "Run npm test"
    assert rows["e2e"]["change"] == "still_failing"
    assert rows["flaky"]["change"] == "fixed"
    assert rows["deploy"]["change"] == "changed"
    assert rows["new-job"]["change"] == "added" and rows["new-job"]["base"] is None
    assert rows["old-job"]["change"] == "removed" and rows["old-job"]["head"] is None
    assert rows["build"]["change"] == "slower" and rows["build"]["duration_delta_s"] == 80
    assert rows["lint"]["change"] == "unchanged"  # +2 s : sous les seuils
    # Échec autorisé des deux côtés : ni cassé, ni « toujours en échec ».
    assert rows["docs"]["change"] == "unchanged"
    # Ce qui explique un échec d'abord.
    assert [row["change"] for row in compare_jobs(base, head)][:3] == ["broken", "still_failing", "fixed"]


def test_duplicate_job_names_are_suffixed():
    rows = compare_jobs([_job("step"), _job("step", "failure")], [_job("step"), _job("step")])
    assert [(row["name"], row["change"]) for row in rows] == [("step (2)", "fixed"), ("step", "unchanged")]


def test_build_comparison_summary_and_ci_config_files():
    base = {"run": _run(1, "success", "2026-09-14T08:00:00Z", sha="aaa", duration=200), "jobs": [_job("tests")]}
    head = {"run": _run(2, "failure", "2026-09-14T09:00:00Z", sha="bbb", duration=260), "jobs": [_job("tests", "failure")]}
    commits = commit_range(status="ahead", commits=[], files=[{"path": ".github/workflows/ci.yml", "previous_path": None, "status": "modified"}, {"path": "src/app.ts", "previous_path": None, "status": "modified"}])
    result = build_comparison(base, head, commits)
    assert result["summary"]["broken"] == 1
    assert result["summary"]["duration_delta_s"] == 60
    assert result["summary"]["duration_change"] == pytest.approx(0.3)
    assert result["summary"]["same_commit"] is False
    assert result["commits"]["ci_config_changed"] is True
    assert [item["ci_config"] for item in result["commits"]["files"]] == [True, False]


@pytest.mark.parametrize(
    ("path", "expected"),
    [(".github/workflows/ci.yml", True), (".github/actions/setup/action.yml", True), (".gitlab-ci.yml", True), (".gitlab/ci/test.yml", True), ("bitbucket-pipelines.yml", True), ("src/ci.yml", False), (None, False)],
)
def test_is_ci_config(path, expected):
    assert is_ci_config(path) is expected


def test_commit_range_totals():
    commits = [{"sha": str(i)} for i in range(MAX_COMMITS + 20)]
    result = commit_range(status="ahead", commits=commits)
    assert result["total_commits"] == MAX_COMMITS + 20 and len(result["commits"]) == MAX_COMMITS and result["commits_truncated"]
    unknown = commit_range(status="ahead", commits=commits[:5], more_commits=True)
    assert unknown["total_commits"] is None and unknown["commits_truncated"]


# ---------------------------------------------------------------------------
# Plateformes
# ---------------------------------------------------------------------------


def _router(routes):
    def handler(request):
        route = routes.get(f"{request.method} {request.url.raw_path.decode().split('?')[0]}")
        if route is None:
            return httpx.Response(404, json={"message": "Not Found"})
        return route(request) if callable(route) else route

    return httpx.MockTransport(handler)


def test_github_compare_commits():
    payload = {
        "status": "ahead",
        "ahead_by": 2,
        "behind_by": 0,
        "total_commits": 2,
        "html_url": "https://github.com/acme/app/compare/aaa...bbb",
        "commits": [
            {"sha": "c1", "html_url": "https://github.com/acme/app/commit/c1", "commit": {"message": "feat: un\n\ncorps", "author": {"name": "Marie", "date": "2026-09-14T08:00:00Z"}}, "author": {"login": "marie", "avatar_url": "https://a/m"}},
            {"sha": "c2", "html_url": "https://github.com/acme/app/commit/c2", "commit": {"message": "fix: deux", "author": {"name": "Tom", "date": "2026-09-14T09:00:00Z"}}, "author": None},
        ],
        "files": [
            {"filename": "src/a.ts", "status": "modified", "additions": 3, "deletions": 1},
            {"filename": "src/b.ts", "previous_filename": "src/old-b.ts", "status": "renamed", "additions": 0, "deletions": 0},
        ],
    }
    service = GitHubService(GitHubClient("t", transport=_router({"GET /repos/acme/app/compare/aaa...bbb": httpx.Response(200, json=payload)})))
    result = service.compare_commits("acme/app", "aaa", "bbb")
    assert [commit["sha"] for commit in result["commits"]] == ["c2", "c1"]  # du plus récent au plus ancien
    assert result["commits"][1]["title"] == "feat: un" and result["commits"][1]["author"]["login"] == "marie"
    assert result["files"][1] == {"path": "src/b.ts", "previous_path": "src/old-b.ts", "status": "renamed", "additions": 0, "deletions": 0}
    assert result["total_commits"] == 2 and not result["commits_truncated"] and not result["files_truncated"]
    assert result["html_url"].endswith("aaa...bbb")


def test_gitlab_compare_commits_ahead_and_behind():
    project = {"id": 42, "path_with_namespace": "grp/app", "path": "app", "name": "App", "namespace": {"full_path": "grp"}, "default_branch": "main", "web_url": "https://gitlab.com/grp/app"}

    def compare(request):
        if request.url.params["from"] == "aaa":
            return httpx.Response(
                200,
                json={
                    "commits": [
                        {"id": "c1", "message": "feat: un", "author_name": "Marie", "created_at": "2026-09-14T08:00:00Z"},
                        {"id": "c2", "message": "fix: deux", "author_name": "Tom", "created_at": "2026-09-14T09:00:00Z", "web_url": "https://gitlab.com/grp/app/-/commit/c2"},
                    ],
                    "diffs": [
                        {"old_path": ".gitlab-ci.yml", "new_path": ".gitlab-ci.yml", "diff": "@@ -1 +1,2 @@\n-a\n+b\n+c\n"},
                        {"old_path": "new.py", "new_path": "new.py", "new_file": True, "diff": None},
                    ],
                },
            )
        return httpx.Response(200, json={"commits": [], "diffs": []})

    routes = {"GET /api/v4/projects/grp%2Fapp": httpx.Response(200, json=project), "GET /api/v4/projects/42/repository/compare": compare}
    service = GitLabService(GitLabClient("t", transport=_router(routes)))
    result = service.compare_commits("grp/app", "aaa", "bbb")
    assert result["status"] == "ahead" and result["ahead_by"] == 2
    assert [commit["sha"] for commit in result["commits"]] == ["c2", "c1"]
    assert result["commits"][1]["html_url"] == "https://gitlab.com/grp/app/-/commit/c1"
    assert result["files"][0] == {"path": ".gitlab-ci.yml", "previous_path": None, "status": "modified", "additions": 2, "deletions": 1}
    assert result["files"][1]["status"] == "added" and result["files"][1]["additions"] is None

    def reversed_compare(request):
        commits = [{"id": "c9", "message": "x", "created_at": "2026-09-14T09:00:00Z"}] if request.url.params["from"] == "bbb" else []
        return httpx.Response(200, json={"commits": commits, "diffs": []})

    routes["GET /api/v4/projects/42/repository/compare"] = reversed_compare
    behind = GitLabService(GitLabClient("t", transport=_router(routes))).compare_commits("grp/app", "aaa", "bbb")
    assert behind["status"] == "behind" and behind["behind_by"] == 1 and behind["commits"] == []


def test_bitbucket_compare_commits():
    calls = []

    def commits(request):
        calls.append(request)
        assert request.url.params["exclude"] == "aaa"
        return httpx.Response(
            200,
            json={
                "values": [
                    {"hash": "c2", "message": "fix: deux\n", "date": "2026-09-14T09:00:00+00:00", "author": {"raw": "Tom <tom@example.org>"}, "links": {"html": {"href": "https://bitbucket.org/acme/app/commits/c2"}}},
                    {"hash": "c1", "message": "feat: un", "date": "2026-09-14T08:00:00+00:00", "author": {"raw": "Marie <m@example.org>", "user": {"display_name": "Marie", "nickname": "marie", "links": {"avatar": {"href": "https://a/m"}}}}},
                ],
                "next": "https://api.bitbucket.org/2.0/...page=2",
            },
        )

    diffstat = {"size": 2, "values": [{"status": "modified", "lines_added": 4, "lines_removed": 2, "old": {"path": "bitbucket-pipelines.yml"}, "new": {"path": "bitbucket-pipelines.yml"}}, {"status": "removed", "lines_added": 0, "lines_removed": 9, "old": {"path": "old.py"}, "new": None}]}
    routes = {"GET /2.0/repositories/acme/app/commits/bbb": commits, "GET /2.0/repositories/acme/app/diffstat/bbb..aaa": httpx.Response(200, json=diffstat)}
    service = BitbucketService(BitbucketClient(access_token="t", transport=_router(routes)))
    result = service.compare_commits("acme/app", "aaa", "bbb")
    assert [commit["sha"] for commit in result["commits"]] == ["c2", "c1"]
    assert result["commits"][0]["author"]["name"] == "Tom" and result["commits"][1]["author"]["login"] == "marie"
    assert result["total_commits"] is None and result["commits_truncated"] and result["ahead_by"] is None  # page suivante : total inconnu
    assert result["files_total"] == 2 and result["files"][1] == {"path": "old.py", "previous_path": None, "status": "removed", "additions": 0, "deletions": 9}


# ---------------------------------------------------------------------------
# Moteur
# ---------------------------------------------------------------------------


@pytest.fixture
def demo_api(tmp_path):
    api = Api(settings_store=SettingsStore(tmp_path / "settings.json"))
    api.call("start_demo")
    return api


def test_demo_compare_failed_run_with_last_success(demo_api):
    runs = demo_api.call("list_runs", {"provider": "github", "full_name": "acme/payments-api", "status": "failure"})["data"]["runs"]
    result = demo_api.call("compare_runs", {"provider": "github", "full_name": "acme/payments-api", "run_id": runs[0]["id"]})
    assert result["ok"], result
    data = result["data"]
    assert data["base"]["state"] == "success" and data["base"]["created_at"] < data["head"]["created_at"]
    assert data["baseline"] in ("same_branch", "default_branch")
    assert data["summary"]["broken"] >= 1 and data["jobs"][0]["change"] == "broken"
    assert data["commits"]["status"] == "ahead" and data["commits"]["total_commits"] >= 1 and data["commits"]["files"]

    # Référence choisie à la main.
    manual = demo_api.call("compare_runs", {"provider": "github", "full_name": "acme/payments-api", "run_id": runs[0]["id"], "base_run_id": runs[1]["id"]})["data"]
    assert manual["baseline"] == "manual" and manual["base"]["id"] == runs[1]["id"]


def test_demo_compare_flaky_rerun_on_same_commit(demo_api):
    runs = demo_api.call("list_runs", {"provider": "github", "full_name": "acme/storefront"})["data"]["runs"]
    by_sha = {}
    pair = None
    for run in sorted((r for r in runs if r["name"] == "CI"), key=lambda r: r["created_at"]):
        previous = by_sha.get(run["head_sha"])
        if previous and previous["state"] == "failure" and run["state"] == "success":
            pair = (previous, run)
        by_sha[run["head_sha"]] = run
    assert pair, "la démo doit contenir une relance réussie sur le même commit"
    data = demo_api.call("compare_runs", {"provider": "github", "full_name": "acme/storefront", "run_id": pair[1]["id"], "base_run_id": pair[0]["id"]})["data"]
    assert data["summary"]["same_commit"] is True and data["summary"]["fixed"] >= 1
    assert data["commits"] is None


class _FakeGitHub:
    provider = "github"

    def __init__(self, runs):
        self.runs = runs

    def close(self):
        pass

    def get_user(self):
        return {"login": "marie", "name": "Marie", "avatar_url": None, "html_url": None}

    def rate_limit(self):
        return None

    def get_repository(self, full_name):
        return {"default_branch": "main"}

    def list_runs(self, full_name, workflow_id=None, branch=None, status=None, page=1, per_page=30):
        runs = [r for r in self.runs if (branch is None or r["branch"] == branch) and (status is None or r["state"] == status)]
        return {"runs": runs, "total_count": len(runs), "page": 1, "has_more": False}

    def get_run(self, full_name, run_id):
        return {"run": next(r for r in self.runs if r["id"] == run_id), "jobs": [_job("tests", "failure" if run_id == "2" else "success")], "capabilities": {}}

    def compare_commits(self, full_name, base_sha, head_sha):
        raise NotFoundError("No common ancestor")


def test_compare_falls_back_to_default_branch_and_survives_missing_commits(tmp_path):
    runs = [_run(2, "failure", "2026-09-14T10:00:00Z", sha="bbb", branch="feat/x"), _run(1, "success", "2026-09-14T09:00:00Z", sha="aaa", branch="main")]

    class Store:
        def load(self, provider):
            return None

        def save(self, provider, credentials):
            return True

        def clear(self, provider):
            pass

    api = Api(Store(), SettingsStore(tmp_path / "settings.json"), {"github": lambda credentials: _FakeGitHub(runs)})
    assert api.call("connect_account", {"provider": "github", "credentials": {"token": "t"}})["ok"]
    data = api.call("compare_runs", {"provider": "github", "full_name": "acme/app", "run_id": "2"})["data"]
    assert data["base"]["id"] == "1" and data["baseline"] == "default_branch"
    assert data["summary"]["broken"] == 1
    assert data["commits"] is None and "No common ancestor" in data["commits_error"]

    lonely = Api(Store(), SettingsStore(tmp_path / "other.json"), {"github": lambda credentials: _FakeGitHub(runs[:1])})
    lonely.call("connect_account", {"provider": "github", "credentials": {"token": "t"}})
    empty = lonely.call("compare_runs", {"provider": "github", "full_name": "acme/app", "run_id": "2"})["data"]
    assert empty["base"] is None and empty["summary"] is None and empty["jobs"] == []
