import httpx

from easy_ci.activity import PACES, ActivityWatcher
from easy_ci.api import Api
from easy_ci.bitbucket.service import BitbucketClient, BitbucketService
from easy_ci.errors import NetworkError
from easy_ci.github.client import GitHubClient
from easy_ci.github.service import GitHubService
from easy_ci.gitlab.service import GitLabClient, GitLabService
from easy_ci.storage import SettingsStore


def _run(run_id, status="completed", conclusion="success"):
    return {"id": run_id, "workflow_id": 10, "status": status, "conclusion": conclusion, "run_attempt": 1, "updated_at": "2025-09-14T10:03:30Z"}


class NoCredentials:
    def load(self, provider):
        return None

    def save(self, provider, credentials):
        return False

    def clear(self, provider):
        pass


class FakeService:
    def __init__(self, fingerprints=None, rate=None):
        self.fingerprints = dict(fingerprints or {})
        self.rate = rate
        self.probed = []

    def rate_limit(self):
        return self.rate

    def run_activity(self, full_name):
        self.probed.append(full_name)
        value = self.fingerprints.get(full_name, "fp0")
        if isinstance(value, Exception):
            raise value
        return value


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def make_watcher(services, demo=False):
    clock = Clock()
    return ActivityWatcher(lambda provider: services[provider], demo=lambda: demo, clock=clock), clock


# -- Empreintes des fournisseurs ---------------------------------------------


def test_github_activity_shares_the_scan_request_and_its_etag():
    runs = {"workflow_runs": [_run(2, status="in_progress", conclusion=None), _run(1)]}
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.path == "/repos/acme/app/actions/workflows":
            return httpx.Response(200, json={"workflows": [{"id": 10, "name": "CI", "path": ".github/workflows/ci.yml", "state": "active"}]})
        if request.headers.get("If-None-Match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(200, json=runs, headers={"ETag": '"v1"'})

    service = GitHubService(GitHubClient("token", transport=httpx.MockTransport(handler)))
    first = service.run_activity("acme/app")
    assert service.run_activity("acme/app") == first
    assert calls[-1].headers["If-None-Match"] == '"v1"', "sonde suivante : requête conditionnelle (304 gratuit)"

    service.scan_repository("acme/app")
    run_requests = [c for c in calls if c.url.path.endswith("/actions/runs")]
    assert run_requests[-1].headers.get("If-None-Match") == '"v1"', "le scan réutilise la réponse de la sonde"
    assert {str(c.url.params) for c in run_requests} == {"per_page=100"}


def test_github_activity_changes_when_a_run_starts_or_progresses():
    state = {"runs": [_run(1)]}

    def handler(request):
        return httpx.Response(200, json={"workflow_runs": state["runs"]})

    service = GitHubService(GitHubClient("token", transport=httpx.MockTransport(handler)))
    idle = service.run_activity("acme/app")
    state["runs"] = [_run(2, status="queued", conclusion=None), _run(1)]
    queued = service.run_activity("acme/app")
    state["runs"] = [_run(2, status="in_progress", conclusion=None), _run(1)]
    running = service.run_activity("acme/app")
    assert len({idle, queued, running}) == 3


def test_github_activity_without_actions_is_stable():
    service = GitHubService(GitHubClient("token", transport=httpx.MockTransport(lambda r: httpx.Response(404, json={"message": "Not Found"}))))
    assert service.run_activity("acme/app") == service.run_activity("acme/other")


def test_gitlab_and_bitbucket_activity_follow_pipeline_states():
    pipelines = [{"id": 7, "status": "running", "updated_at": "2025-09-14T10:00:00Z"}]

    def gitlab(request):
        if request.url.path.endswith("/pipelines"):
            assert request.url.params["per_page"] == "30"
            return httpx.Response(200, json=pipelines)
        return httpx.Response(200, json={"id": 42, "path_with_namespace": "grp/app", "name": "app", "default_branch": "main", "web_url": "https://gitlab.com/grp/app"})

    gl = GitLabService(GitLabClient("glpat", host="https://gitlab.com", transport=httpx.MockTransport(gitlab)))
    before = gl.run_activity("grp/app")
    pipelines[0] = {**pipelines[0], "status": "success"}
    assert gl.run_activity("grp/app") != before

    values = [{"uuid": "{a}", "state": {"name": "IN_PROGRESS"}}]

    def bitbucket(request):
        assert request.url.params["sort"] == "-created_on"
        return httpx.Response(200, json={"values": values})

    bb = BitbucketService(BitbucketClient(access_token="tok", transport=httpx.MockTransport(bitbucket)))
    before = bb.run_activity("ws/app")
    values[0] = {"uuid": "{a}", "state": {"name": "COMPLETED", "result": {"name": "FAILED"}}, "completed_on": "2025-09-14T10:05:00Z"}
    assert bb.run_activity("ws/app") != before


# -- Rythme des sondes -----------------------------------------------------


def test_poll_probes_each_repository_then_waits_for_its_interval():
    github = FakeService()
    watcher, clock = make_watcher({"github": github})
    result = watcher.poll(["github:acme/a", "github:acme/b"])
    assert result == {"fingerprints": {"github:acme/a": "fp0", "github:acme/b": "fp0"}, "probed": 2}

    clock.now += 5
    again = watcher.poll(["github:acme/a", "github:acme/b"])
    assert again["probed"] == 0 and again["fingerprints"] == result["fingerprints"], "sans sonde, la dernière empreinte est renvoyée"

    clock.now += PACES["github"].min_interval
    github.fingerprints["acme/a"] = "fp1"
    assert watcher.poll(["github:acme/a", "github:acme/b"])["fingerprints"]["github:acme/a"] == "fp1"


def test_interval_grows_with_the_number_of_repositories_to_respect_the_budget():
    bitbucket = FakeService()
    watcher, clock = make_watcher({"bitbucket": bitbucket})
    keys = [f"bitbucket:ws/r{i}" for i in range(10)]
    probed = 0
    for _ in range(12 * 10):  # 10 minutes, un appel toutes les 5 secondes
        probed += watcher.poll(keys)["probed"]
        clock.now += 5
    assert probed <= PACES["bitbucket"].per_minute * 10 + 2
    assert set(bitbucket.probed) == {f"ws/r{i}" for i in range(10)}, "chaque dépôt finit par être sondé"


def test_low_quota_pauses_the_probes_of_that_provider_only():
    github = FakeService(rate={"limit": 5000, "remaining": 100, "reset_at": 0})
    gitlab = FakeService()
    watcher, _ = make_watcher({"github": github, "gitlab": gitlab})
    result = watcher.poll(["github:acme/a", "gitlab:grp/b"])
    assert github.probed == [] and gitlab.probed == ["grp/b"]
    assert result["fingerprints"] == {"gitlab:grp/b": "fp0"}


def test_failed_probe_keeps_the_previous_fingerprint_and_other_repositories():
    github = FakeService()
    watcher, clock = make_watcher({"github": github})
    watcher.poll(["github:acme/a", "github:acme/b"])
    github.fingerprints = {"acme/a": NetworkError("offline"), "acme/b": RuntimeError("unexpected")}
    clock.now += 60
    result = watcher.poll(["github:acme/a", "github:acme/b"])
    assert result["fingerprints"] == {"github:acme/a": "fp0", "github:acme/b": "fp0"}


def test_untracked_repositories_are_forgotten_and_reset_clears_everything():
    github = FakeService()
    watcher, _ = make_watcher({"github": github})
    watcher.poll(["github:acme/a", "github:acme/b"])
    assert watcher.poll(["github:acme/a"])["fingerprints"] == {"github:acme/a": "fp0"}
    watcher.reset()
    assert watcher.poll([])["fingerprints"] == {}


def test_api_poll_activity_in_demo_mode(tmp_path):
    api = Api(credential_store=NoCredentials(), settings_store=SettingsStore(tmp_path / "settings.json"))
    api.call("start_demo")
    repos = api.call("list_repositories", {"provider": "github"})["data"]
    keys = [repo["key"] for repo in repos[:3]]
    response = api.call("poll_activity", {"repositories": keys})
    assert response["ok"] is True
    assert set(response["data"]["fingerprints"]) == set(keys)
    assert api.call("poll_activity", {"repositories": keys})["data"]["probed"] == 0, "rythme de 5 s en démo"
