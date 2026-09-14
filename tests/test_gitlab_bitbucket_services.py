import base64
import json

import httpx
import pytest

from easy_ci.bitbucket.service import BitbucketClient, BitbucketService
from easy_ci.errors import AuthError, EasyCIError
from easy_ci.gitlab.service import GitLabClient, GitLabService, normalize_host
from easy_ci.state import bitbucket_state, gitlab_state


def router(routes, calls):
    def handler(request):
        calls.append(request)
        key = f"{request.method} {request.url.raw_path.decode().split('?')[0]}"
        route = routes.get(key)
        if route is None:
            return httpx.Response(404, json={"message": "404 Not Found"})
        return route(request) if callable(route) else route

    return handler


# ---------------------------------------------------------------------------
# GitLab
# ---------------------------------------------------------------------------

PROJECT = {
    "id": 42,
    "path_with_namespace": "platform/backend/billing",
    "path": "billing",
    "name": "Billing",
    "namespace": {"full_path": "platform/backend"},
    "visibility": "private",
    "default_branch": "main",
    "web_url": "https://gitlab.example.org/platform/backend/billing",
    "last_activity_at": "2026-09-14T08:00:00Z",
    "ci_config_path": "",
}

PIPELINES = [
    {"id": 902, "iid": 88, "sha": "bbb", "ref": "main", "status": "running", "source": "push", "created_at": "2026-09-14T09:00:00Z", "updated_at": "2026-09-14T09:01:00Z", "web_url": "https://gitlab.example.org/p/-/pipelines/902"},
    {"id": 901, "iid": 87, "sha": "aaa", "ref": "feat/x", "status": "failed", "source": "merge_request_event", "created_at": "2026-09-14T08:00:00Z", "updated_at": "2026-09-14T08:05:00Z", "web_url": "https://gitlab.example.org/p/-/pipelines/901"},
]


def gitlab_service(extra_routes=None):
    calls = []
    routes = {
        "GET /api/v4/user": httpx.Response(200, json={"username": "marie", "name": "Marie", "web_url": "https://gitlab.example.org/marie"}),
        "GET /api/v4/projects/platform%2Fbackend%2Fbilling": httpx.Response(200, json=PROJECT),
        "GET /api/v4/projects/42/pipelines": httpx.Response(200, json=PIPELINES, headers={"x-total": "2", "RateLimit-Limit": "2000", "RateLimit-Remaining": "1990", "RateLimit-Reset": "1790000000"}),
        "GET /api/v4/projects/42/pipelines/902": httpx.Response(200, json={**PIPELINES[0], "user": {"username": "lea", "avatar_url": "https://a/lea"}, "started_at": "2026-09-14T09:00:05Z", "finished_at": None, "duration": None}),
        "GET /api/v4/projects/42/pipelines/901": httpx.Response(200, json={**PIPELINES[1], "user": {"username": "tom"}, "started_at": "2026-09-14T08:00:10Z", "finished_at": "2026-09-14T08:05:00Z", "duration": 290}),
        "GET /api/v4/projects/42/repository/commits/aaa": httpx.Response(200, json={"title": "fix: prorata", "message": "fix: prorata\n\ndétails"}),
        "GET /api/v4/projects/42/repository/commits/bbb": httpx.Response(200, json={"title": "feat: TVA", "message": "feat: TVA"}),
        **(extra_routes or {}),
    }
    client = GitLabClient("glpat", host="gitlab.example.org/", transport=httpx.MockTransport(router(routes, calls)))
    return GitLabService(client), calls


def test_gitlab_state_mapping():
    assert gitlab_state("pending") == "queued"
    assert gitlab_state("manual") == "action_required"
    assert gitlab_state("failed", allow_failure=True) == "neutral"
    assert normalize_host("gitlab.example.org/api/v4/") == "https://gitlab.example.org"


def test_gitlab_scan_enriches_recent_pipelines():
    service, calls = gitlab_service()
    scan = service.scan_repository("platform/backend/billing")
    assert calls[0].headers["PRIVATE-TOKEN"] == "glpat"
    assert str(calls[0].url).startswith("https://gitlab.example.org/api/v4/")

    assert scan["state"] == "running"
    workflow = scan["workflows"][0]
    assert workflow["path"] == ".gitlab-ci.yml" and workflow["html_url"].endswith("/-/pipelines")
    running, failed = scan["recent_runs"]
    assert running["title"] == "feat: TVA" and running["actor"]["login"] == "lea" and running["duration_s"] is None
    assert failed["state"] == "failure" and failed["event"] == "merge_request" and failed["duration_s"] == 290
    assert failed["commit_message"] == "fix: prorata\n\ndétails"
    assert service.rate_limit() == {"limit": 2000, "remaining": 1990, "reset_at": 1790000000}

    # Second scan : pipeline terminé et commits en cache, seul le pipeline en cours est redemandé.
    calls.clear()
    service.scan_repository("platform/backend/billing")
    paths = sorted(c.url.path for c in calls)
    assert paths == ["/api/v4/projects/42/pipelines", "/api/v4/projects/42/pipelines/902"]


def test_gitlab_project_without_ci():
    service, _ = gitlab_service({"GET /api/v4/projects/42/pipelines": httpx.Response(200, json=[])})
    scan = service.scan_repository("platform/backend/billing")
    assert scan["has_ci"] is False


def test_gitlab_run_jobs_logs_and_annotations():
    trace = "\x1b[0Ksection_start:1:step_script\r\x1b[0KExecuting step_script\n$ pytest\nFAILED test_a\n\x1b[0Ksection_end:2:step_script\r\x1b[0K\n\x1b[31;1mERROR: Job failed: exit code 1\x1b[0;m\n"
    jobs = [
        {"id": 7002, "name": "deploy", "stage": "deploy", "status": "skipped", "allow_failure": False},
        {"id": 7001, "name": "unit-tests", "stage": "test", "status": "failed", "allow_failure": False, "failure_reason": "script_failure", "started_at": "2026-09-14T08:01:00Z", "finished_at": "2026-09-14T08:03:00Z", "duration": 120.4, "runner": {"description": "blue-3"}, "tag_list": ["docker"], "web_url": "https://gl/j/7001"},
    ]
    job_detail = {**jobs[1], "pipeline": {"id": 901}}
    report = {"test_suites": [{"name": "unit-tests", "test_cases": [{"status": "failed", "name": "test_a", "classname": "tests.test_invoices", "file": "tests/test_invoices.py", "system_output": "AssertionError: 14.49 != 14.50"}, {"status": "success", "name": "ok"}]}]}
    service, calls = gitlab_service(
        {
            "GET /api/v4/projects/42/pipelines/901/jobs": httpx.Response(200, json=jobs),
            "GET /api/v4/projects/42/jobs/7001": httpx.Response(200, json=job_detail),
            "GET /api/v4/projects/42/jobs/7001/trace": httpx.Response(200, text=trace),
            "GET /api/v4/projects/42/pipelines/901/test_report": httpx.Response(200, json=report),
            "POST /api/v4/projects/42/pipelines/901/retry": httpx.Response(201, json={"id": 901}),
            "POST /api/v4/projects/42/pipeline": httpx.Response(201, json={"id": 903}),
            "POST /api/v4/projects/42/pipelines/901/cancel": httpx.Response(200, json={"id": 901}),
        }
    )
    detail = service.get_run("platform/backend/billing", "901")
    assert detail["run"]["title"] == "fix: prorata"
    assert [(j["name"], j["stage"], j["state"]) for j in detail["jobs"]] == [("unit-tests", "test", "failure"), ("deploy", "deploy", "skipped")]
    assert detail["jobs"][0]["duration_s"] == 120 and detail["jobs"][0]["runner_name"] == "blue-3"
    assert detail["capabilities"]["live_logs"] is True

    log = service.get_job_log("platform/backend/billing", "7001")
    assert log["available"] and log["complete"]
    assert log["groups"][0]["title"] == "Executing step_script"
    assert log["errors"] and log["excerpts"][0]["line"] == log["errors"][0]

    annotations = service.get_job_annotations("platform/backend/billing", "7001")
    assert annotations[0]["title"] == "tests.test_invoices › test_a" and annotations[0]["path"] == "tests/test_invoices.py"
    assert "script" in annotations[-1]["message"]

    assert service.rerun_run("platform/backend/billing", "901", failed_only=True) == {"run_id": "901"}
    assert service.rerun_run("platform/backend/billing", "901") == {"run_id": "903"}
    new_pipeline = next(c for c in calls if c.method == "POST" and c.url.path == "/api/v4/projects/42/pipeline")
    assert new_pipeline.url.params["ref"] == "feat/x"
    service.cancel_run("platform/backend/billing", "901")


def test_gitlab_workflow_file():
    content = "stages: [test]\ntest:\n  script: [pytest]\n"
    service, _ = gitlab_service(
        {"GET /api/v4/projects/42/repository/files/.gitlab-ci.yml": httpx.Response(200, json={"content": base64.b64encode(content.encode()).decode(), "blob_id": "b1"})}
    )
    file = service.get_workflow_file("platform/backend/billing", ".gitlab-ci.yml")
    assert file["content"] == content and file["summary"]["stages"] == ["test"]
    assert file["html_url"] == "https://gitlab.example.org/platform/backend/billing/-/blob/main/.gitlab-ci.yml"


def test_gitlab_auth_error_message():
    service, _ = gitlab_service({"GET /api/v4/user": httpx.Response(401, json={"message": "401 Unauthorized"})})
    with pytest.raises(AuthError, match="GitLab"):
        service.get_user()


# ---------------------------------------------------------------------------
# Bitbucket
# ---------------------------------------------------------------------------

REPO = {
    "uuid": "{repo-1}",
    "full_name": "acme-team/importer",
    "slug": "importer",
    "workspace": {"slug": "acme-team"},
    "is_private": True,
    "mainbranch": {"name": "main"},
    "links": {"html": {"href": "https://bitbucket.org/acme-team/importer"}},
    "updated_on": "2026-09-14T08:00:00+00:00",
}

PIPELINE_FAILED = {
    "uuid": "{pipe-2}",
    "build_number": 12,
    "state": {"name": "COMPLETED", "result": {"name": "FAILED"}},
    "target": {"type": "pipeline_ref_target", "ref_type": "branch", "ref_name": "main", "commit": {"hash": "c0ffee"}, "selector": {"type": "branches", "pattern": "main"}},
    "trigger": {"name": "PUSH"},
    "creator": {"display_name": "Léa", "nickname": "lea", "links": {"avatar": {"href": "https://a/lea"}}},
    "created_on": "2026-09-14T08:00:00Z",
    "completed_on": "2026-09-14T08:02:00Z",
    "duration_in_seconds": 118,
}
PIPELINE_RUNNING = {
    **PIPELINE_FAILED,
    "uuid": "{pipe-3}",
    "build_number": 13,
    "state": {"name": "IN_PROGRESS", "stage": {"name": "RUNNING"}},
    "trigger": {"name": "MANUAL"},
    "target": {"type": "pipeline_ref_target", "ref_name": "main", "commit": {"hash": "c0ffee"}, "selector": {"type": "custom", "pattern": "import-production"}},
}


def bitbucket_service(extra_routes=None):
    calls = []
    routes = {
        "GET /2.0/user": httpx.Response(200, json={"display_name": "Marie", "nickname": "marie", "links": {"avatar": {"href": "https://a/m"}}}),
        "GET /2.0/repositories": lambda r: httpx.Response(200, json={"values": [REPO], "next": "https://api.bitbucket.org/2.0/repositories?page=2"}) if r.url.params.get("page") != "2" else httpx.Response(200, json={"values": [{**REPO, "full_name": "acme-team/other", "slug": "other"}]}),
        "GET /2.0/repositories/acme-team/importer": httpx.Response(200, json=REPO),
        "GET /2.0/repositories/acme-team/importer/pipelines/": httpx.Response(200, json={"values": [PIPELINE_RUNNING, PIPELINE_FAILED], "size": 2}),
        "GET /2.0/repositories/acme-team/importer/commit/c0ffee": httpx.Response(200, json={"message": "fix: encodage latin1\n"}),
        **(extra_routes or {}),
    }
    client = BitbucketClient(email="marie@example.org", api_token="ATATT", transport=httpx.MockTransport(router(routes, calls)))
    return BitbucketService(client), calls


def test_bitbucket_state_mapping():
    assert bitbucket_state({"name": "PENDING"}) == "queued"
    assert bitbucket_state({"name": "IN_PROGRESS", "stage": {"name": "RUNNING"}}) == "running"
    assert bitbucket_state({"name": "IN_PROGRESS", "stage": {"name": "PAUSED"}}) == "action_required"
    assert bitbucket_state({"name": "COMPLETED", "result": {"name": "STOPPED"}}) == "cancelled"
    assert bitbucket_state({"name": "COMPLETED", "result": {"name": "ERROR"}}) == "failure"


def test_bitbucket_client_requires_credentials():
    with pytest.raises(EasyCIError):
        BitbucketClient(email="marie@example.org")


def test_bitbucket_repositories_and_scan():
    service, calls = bitbucket_service()
    repos = service.list_repositories()
    assert [r["full_name"] for r in repos] == ["acme-team/importer", "acme-team/other"]
    assert calls[0].headers["Authorization"].startswith("Basic ")
    assert repos[0]["key"] == "bitbucket:acme-team/importer" and repos[0]["ci_config_path"] == "bitbucket-pipelines.yml"

    scan = service.scan_repository("acme-team/importer")
    assert scan["state"] == "running"
    running, failed = scan["recent_runs"]
    assert running["name"] == "custom: import-production" and running["event"] == "manual"
    assert failed["title"] == "fix: encodage latin1" and failed["duration_s"] == 118 and failed["run_number"] == 12
    assert failed["html_url"] == "https://bitbucket.org/acme-team/importer/pipelines/results/12"

    filtered = service.list_runs("acme-team/importer", status="failure")
    assert [r["id"] for r in filtered["runs"]] == ["{pipe-2}"]


def test_bitbucket_repo_without_pipelines():
    service, _ = bitbucket_service({"GET /2.0/repositories/acme-team/importer/pipelines/": httpx.Response(200, json={"values": []})})
    assert service.scan_repository("acme-team/importer")["has_ci"] is False


def test_bitbucket_steps_logs_rerun_and_stop():
    steps = {"values": [{"uuid": "{step-1}", "name": "Tests", "state": {"name": "COMPLETED", "result": {"name": "FAILED"}}, "started_on": "2026-09-14T08:00:10Z", "completed_on": "2026-09-14T08:01:50Z", "duration_in_seconds": 100, "image": {"name": "python:3.13"}}]}
    log_text = "+ pip install -r requirements.txt\nSuccessfully installed pandas\n+ python -m pytest -q\nFAILED tests/test_catalog.py::test_encoding\n1 failed, 32 passed\n"
    service, calls = bitbucket_service(
        {
            "GET /2.0/repositories/acme-team/importer/pipelines/%7Bpipe-2%7D": httpx.Response(200, json=PIPELINE_FAILED),
            "GET /2.0/repositories/acme-team/importer/pipelines/%7Bpipe-2%7D/steps/": httpx.Response(200, json=steps),
            "GET /2.0/repositories/acme-team/importer/pipelines/%7Bpipe-2%7D/steps/%7Bstep-1%7D": httpx.Response(200, json=steps["values"][0]),
            "GET /2.0/repositories/acme-team/importer/pipelines/%7Bpipe-2%7D/steps/%7Bstep-1%7D/log": httpx.Response(200, text=log_text),
            "POST /2.0/repositories/acme-team/importer/pipelines/": httpx.Response(201, json={"uuid": "{pipe-4}"}),
            "POST /2.0/repositories/acme-team/importer/pipelines/%7Bpipe-2%7D/stopPipeline": httpx.Response(204),
        }
    )
    detail = service.get_run("acme-team/importer", "{pipe-2}")
    job = detail["jobs"][0]
    assert job["id"] == "{pipe-2}:{step-1}" and job["state"] == "failure" and job["labels"] == ["python:3.13"]
    assert detail["capabilities"]["rerun_failed"] is False

    log = service.get_job_log("acme-team/importer", job["id"])
    assert [g["title"] for g in log["groups"]] == ["+ pip install -r requirements.txt", "+ python -m pytest -q"]
    assert log["errors"] == [] and log["excerpts"][0]["inferred"] is True

    assert service.rerun_run("acme-team/importer", "{pipe-2}") == {"run_id": "{pipe-4}"}
    created = next(c for c in calls if c.method == "POST" and c.url.path.endswith("/pipelines/"))
    assert json.loads(created.content)["target"] == {"type": "pipeline_ref_target", "ref_type": "branch", "ref_name": "main", "selector": {"type": "branches", "pattern": "main"}}
    service.cancel_run("acme-team/importer", "{pipe-2}")
    assert calls[-1].url.path.endswith("/stopPipeline")


def test_bitbucket_access_token_uses_bearer():
    calls = []
    client = BitbucketClient(access_token="tok", transport=httpx.MockTransport(router({"GET /2.0/user": httpx.Response(200, json={"display_name": "Bot"})}, calls)))
    assert BitbucketService(client).get_user()["name"] == "Bot"
    assert calls[0].headers["Authorization"] == "Bearer tok"
