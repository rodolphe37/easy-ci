import base64
import json

import httpx
import pytest

from easy_ci.errors import AuthError, NotFoundError, RateLimitError
from easy_ci.github.client import GitHubClient
from easy_ci.github.service import GitHubService
from easy_ci.state import aggregate_state, run_state


def _run(run_id, workflow_id, status="completed", conclusion="success", created="2025-09-14T10:00:00Z"):
    return {
        "id": run_id,
        "name": "CI",
        "display_title": "fix: bug",
        "workflow_id": workflow_id,
        "run_number": run_id,
        "event": "push",
        "status": status,
        "conclusion": conclusion,
        "head_branch": "main",
        "head_sha": "abc",
        "head_commit": {"message": "fix: bug\n\ndetails"},
        "actor": {"login": "marie", "avatar_url": "https://avatars/x"},
        "created_at": created,
        "run_started_at": created,
        "updated_at": "2025-09-14T10:03:30Z",
        "html_url": "https://github.com/acme/app/actions/runs/1",
    }


def make_service(routes):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        key = f"{request.method} {request.url.path}"
        route = routes.get(key)
        if route is None:
            return httpx.Response(404, json={"message": "Not Found"})
        return route(request) if callable(route) else route

    client = GitHubClient("token", transport=httpx.MockTransport(handler))
    return GitHubService(client), calls


def test_state_mapping():
    assert run_state("in_progress", None) == "running"
    assert run_state("waiting", None) == "queued"
    assert run_state("completed", "timed_out") == "failure"
    assert run_state("completed", "cancelled") == "cancelled"
    assert aggregate_state(["success", "failure"]) == "failure"
    assert aggregate_state(["success", "running", "failure"]) == "running"
    assert aggregate_state([]) == "none"


def test_scan_repository_groups_runs_by_workflow():
    workflows = {
        "total_count": 2,
        "workflows": [
            {"id": 1, "name": "CI", "path": ".github/workflows/ci.yml", "state": "active"},
            {"id": 2, "name": "pages-build-deployment", "path": "dynamic/pages/pages-build-deployment", "state": "active"},
        ],
    }
    runs = {
        "workflow_runs": [
            _run(12, 1, conclusion="failure", created="2025-09-14T12:00:00Z"),
            _run(11, 1, created="2025-09-14T11:00:00Z"),
            _run(10, 2, created="2025-09-14T10:00:00Z"),
        ]
    }
    service, _ = make_service(
        {
            "GET /repos/acme/app/actions/workflows": httpx.Response(200, json=workflows),
            "GET /repos/acme/app/actions/runs": httpx.Response(200, json=runs),
        }
    )

    scan = service.scan_repository("acme/app")

    assert scan["has_ci"] is True
    assert scan["state"] == "failure"
    ci, pages = scan["workflows"]
    assert ci["latest_run"]["id"] == "12"
    assert [h["id"] for h in ci["history"]] == ["11", "12"]  # du plus ancien au plus récent
    assert pages["dynamic"] is True
    assert scan["last_run"]["commit_message"] == "fix: bug\n\ndetails"
    assert pages["latest_run"]["duration_s"] == 210


def test_scan_repository_without_workflows():
    service, calls = make_service(
        {"GET /repos/acme/docs/actions/workflows": httpx.Response(200, json={"total_count": 0, "workflows": []})}
    )
    scan = service.scan_repository("acme/docs")
    assert scan["has_ci"] is False and scan["state"] == "none"
    assert len(calls) == 1  # pas d'appel inutile aux runs


def test_etag_cache_reuses_data_on_304():
    def route(request):
        if request.headers.get("If-None-Match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(200, json={"login": "marie"}, headers={"ETag": '"v1"'})

    service, calls = make_service({"GET /user": route})
    assert service.get_user()["login"] == "marie"
    assert service.get_user()["login"] == "marie"
    assert calls[1].headers["If-None-Match"] == '"v1"'


def test_pagination_follows_link_header():
    def route(request):
        if request.url.params.get("page") == "2":
            return httpx.Response(200, json=[{"id": 2, "full_name": "a/b2", "name": "b2", "owner": {"login": "a"}}])
        return httpx.Response(
            200,
            json=[{"id": 1, "full_name": "a/b1", "name": "b1", "owner": {"login": "a"}}],
            headers={"Link": '<https://api.github.com/user/repos?page=2>; rel="next"'},
        )

    service, _ = make_service({"GET /user/repos": route})
    assert [r["full_name"] for r in service.list_repositories()] == ["a/b1", "a/b2"]


def test_errors_are_translated():
    service, _ = make_service(
        {
            "GET /user": httpx.Response(401, json={"message": "Bad credentials"}),
            "GET /repos/a/b": httpx.Response(
                403, json={"message": "API rate limit exceeded"}, headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000", "x-ratelimit-limit": "5000"}
            ),
        }
    )
    with pytest.raises(AuthError):
        service.get_user()
    with pytest.raises(RateLimitError) as exc:
        service.get_repository("a/b")
    assert exc.value.reset_at == 1700000000
    assert service.rate_limit() == {"limit": 5000, "remaining": 0, "reset_at": 1700000000}
    with pytest.raises(NotFoundError):
        service.get_repository("a/missing")


def test_job_log_unavailable_while_running():
    service, _ = make_service({})
    assert service.get_job_log("acme/app", "42") == {"available": False}


def test_job_log_follows_redirect_and_parses():
    service, _ = make_service(
        {
            "GET /repos/acme/app/actions/jobs/42/logs": httpx.Response(302, headers={"Location": "https://blob.example/log.txt"}),
            "GET /log.txt": httpx.Response(200, text="2025-09-14T10:00:00Z ##[error]boom"),
        }
    )
    log = service.get_job_log("acme/app", "42")
    assert log["available"] is True and log["errors"] == [0]


def test_rerun_and_cancel_endpoints():
    service, calls = make_service(
        {
            "POST /repos/acme/app/actions/runs/7/rerun-failed-jobs": httpx.Response(201),
            "POST /repos/acme/app/actions/runs/7/cancel": httpx.Response(202, json={}),
        }
    )
    assert service.rerun_run("acme/app", "7", failed_only=True) == {"run_id": "7"}
    service.cancel_run("acme/app", "7")
    assert [c.url.path for c in calls] == ["/repos/acme/app/actions/runs/7/rerun-failed-jobs", "/repos/acme/app/actions/runs/7/cancel"]


def test_workflow_file_is_decoded_and_summarized():
    content = "name: CI\non:\n  push:\n    branches: [main]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    needs: lint\n    steps:\n      - run: make\n"
    service, _ = make_service(
        {
            "GET /repos/acme/app/contents/.github/workflows/ci.yml": httpx.Response(
                200, json={"sha": "s", "content": base64.b64encode(content.encode()).decode(), "html_url": "u"}
            )
        }
    )
    file = service.get_workflow_file("acme/app", ".github/workflows/ci.yml")
    assert file["content"] == content
    summary = file["summary"]
    assert summary["valid"] is True
    assert summary["triggers"] == [{"event": "push", "details": ["branches: main"]}]
    assert summary["jobs"][0] == {"id": "test", "name": "test", "stage": None, "runs_on": "ubuntu-latest", "needs": ["lint"], "steps": 1, "uses": None, "matrix": False}
    json.dumps(file)  # sérialisable pour le pont JS


def test_etag_cache_is_bounded_and_keeps_the_most_recent():
    """Le cache conservait toutes les réponses : sur une session longue, il grossissait sans fin."""
    from easy_ci.http import ETAG_CACHE_SIZE, ApiClient

    def handler(request):
        return httpx.Response(200, json={"n": request.url.path}, headers={"ETag": f'W/"{request.url.path}"'})

    client = ApiClient("https://example.test", label="T", transport=httpx.MockTransport(handler))
    for index in range(ETAG_CACHE_SIZE + 50):
        client.get_json(f"/repos/o/r{index}/actions/runs")

    assert len(client._etag_cache) == ETAG_CACHE_SIZE
    assert "/repos/o/r0/actions/runs?" not in client._etag_cache, "les plus anciennes sont oubliées"
    assert f"/repos/o/r{ETAG_CACHE_SIZE + 49}/actions/runs?" in client._etag_cache


def test_etag_cache_keeps_entries_that_are_reused():
    """Éviction par ancienneté d'usage : une URL consultée en boucle ne doit pas être évincée."""
    from easy_ci.http import ETAG_CACHE_SIZE, ApiClient

    def handler(request):
        return httpx.Response(200, json={"n": request.url.path}, headers={"ETag": f'W/"{request.url.path}"'})

    client = ApiClient("https://example.test", label="T", transport=httpx.MockTransport(handler))
    favourite = "/repos/o/favori/actions/runs"
    client.get_json(favourite)
    for index in range(ETAG_CACHE_SIZE):
        client.get_json(f"/repos/o/r{index}/actions/runs")
        client.get_json(favourite)

    assert f"{favourite}?" in client._etag_cache
