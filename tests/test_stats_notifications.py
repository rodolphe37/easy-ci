import subprocess

import httpx
import pytest

from easy_ci import notifications
from easy_ci.api import Api
from easy_ci.github.client import GitHubClient
from easy_ci.github.service import GitHubService
from easy_ci.gitlab.service import GitLabClient, GitLabService
from easy_ci.notifications import Notifier
from easy_ci.stats import compute_stats, percentile
from easy_ci.storage import SettingsStore


def _run(run_id, state, created, duration=100, sha=None, attempt=1, workflow="1"):
    return {"id": str(run_id), "run_number": run_id, "state": state, "created_at": created, "duration_s": duration, "head_sha": sha or f"sha{run_id}", "run_attempt": attempt, "workflow_id": workflow, "name": "CI", "branch": "main", "title": "fix"}


def _job(name, state, duration=10, attempt=1, allow_failure=False):
    return {"id": f"{name}-{attempt}", "name": name, "state": state, "duration_s": duration, "attempt": attempt, "allow_failure": allow_failure, "started_at": f"2026-01-01T00:0{attempt}:00Z"}


def test_percentiles():
    assert percentile([], 0.5) is None
    assert percentile([3, 1, 2], 0.5) == 2
    assert percentile([1, 2, 3, 4], 0.5) == 2.5
    assert percentile(list(range(1, 11)), 0.9) == 9


def test_compute_stats_summary_and_trend():
    runs = [_run(i, "failure" if i == 3 else "success", f"2026-01-{i:02d}T10:00:00Z", duration=100 + i * 10) for i in range(1, 9)]
    runs.append(_run(9, "cancelled", "2026-01-09T10:00:00Z", duration=5))
    runs.append(_run(10, "running", "2026-01-10T10:00:00Z", duration=None))
    stats = compute_stats(runs, {})
    summary = stats["summary"]
    assert stats["runs_analyzed"] == 9 and [point["id"] for point in stats["runs"]][:2] == ["1", "2"]
    assert (summary["success"], summary["failure"], summary["cancelled"]) == (7, 1, 1)
    assert summary["success_rate"] == pytest.approx(7 / 8)
    assert summary["duration"]["median"] == 145 and summary["duration"]["min"] == 110  # annulée exclue des durées
    assert summary["trend"]["recent_median"] > summary["trend"]["previous_median"] and summary["trend"]["change"] > 0


def test_job_retried_in_same_run_is_unstable():
    runs = [_run(1, "success", "2026-01-01T10:00:00Z", attempt=2), _run(2, "success", "2026-01-02T10:00:00Z")]
    attempts = {
        "1": [_job("tests", "failure", 30, attempt=1), _job("tests", "success", 32, attempt=2), _job("lint", "success", 5)],
        "2": [_job("tests", "success", 28), _job("lint", "success", 6)],
    }
    jobs = {job["name"]: job for job in compute_stats(runs, attempts)["jobs"]}
    assert jobs["tests"]["unstable"] and jobs["tests"]["reasons"] == ["retried"] and jobs["tests"]["recoveries"] == 1
    assert jobs["tests"]["success"] == 2 and jobs["tests"]["history"][0]["attempts"] == 2
    assert not jobs["lint"]["unstable"] and jobs["lint"]["duration"]["median"] == 5.5
    assert compute_stats(runs, attempts)["jobs"][0]["name"] == "tests"  # jobs instables en premier


def test_same_commit_recovery_and_alternating_jobs():
    # Pipeline relancé sur le même commit (GitLab, Bitbucket) : échec puis succès.
    runs = [_run(1, "failure", "2026-01-01T10:00:00Z", sha="x"), _run(2, "success", "2026-01-01T11:00:00Z", sha="x")]
    attempts = {"1": [_job("e2e", "failure")], "2": [_job("e2e", "success")]}
    assert compute_stats(runs, attempts)["jobs"][0]["reasons"] == ["retried"]

    # Corrigé par un nouveau commit : pas instable.
    runs = [_run(1, "failure", "2026-01-01T10:00:00Z"), _run(2, "success", "2026-01-01T11:00:00Z")]
    assert not compute_stats(runs, attempts)["jobs"][0]["unstable"]

    outcomes = "SFSFSSFS"
    runs = [_run(i, "success" if o == "S" else "failure", f"2026-01-{i + 1:02d}T10:00:00Z") for i, o in enumerate(outcomes)]
    attempts = {str(i): [_job("integration", "success" if o == "S" else "failure")] for i, o in enumerate(outcomes)}
    job = compute_stats(runs, attempts)["jobs"][0]
    assert job["flips"] == 6 and job["reasons"] == ["alternating"] and job["success_rate"] == pytest.approx(5 / 8)


def test_allowed_failures_and_skipped_jobs():
    runs = [_run(1, "success", "2026-01-01T10:00:00Z"), _run(2, "failure", "2026-01-02T10:00:00Z")]
    attempts = {
        "1": [{**_job("lint", "neutral", allow_failure=True)}, _job("deploy", "success")],
        "2": [_job("lint", "success"), _job("deploy", "skipped", duration=None)],
    }
    jobs = {job["name"]: job for job in compute_stats(runs, attempts)["jobs"]}
    assert jobs["lint"]["failure"] == 1 and jobs["lint"]["allowed_failures"] == 1
    assert jobs["deploy"]["skipped"] == 1 and jobs["deploy"]["success_rate"] == 1


def test_api_run_stats_in_demo(tmp_path):
    api = Api(settings_store=SettingsStore(tmp_path / "settings.json"))
    api.call("start_demo")
    result = api.call("get_run_stats", {"provider": "github", "full_name": "acme/storefront", "workflow_id": "50000", "limit": 30})
    assert result["ok"], result
    stats = result["data"]
    assert stats["runs_analyzed"] >= 10 and stats["limit"] == 30 and stats["incomplete_runs"] == 0
    tests = next(job for job in stats["jobs"] if job["name"] == "Tests")
    assert tests["unstable"] and "retried" in tests["reasons"]  # démo : test instable relancé sur le même commit
    assert len({point["duration_s"] for point in stats["runs"]}) > 3  # durées variables d'une exécution à l'autre
    # Deuxième appel : jobs des exécutions terminées servis par le cache.
    cached = len(api._attempts_cache)
    assert api.call("get_run_stats", {"provider": "github", "full_name": "acme/storefront", "workflow_id": "50000", "limit": 30})["ok"]
    assert len(api._attempts_cache) == cached


def test_demo_rerun_keeps_previous_attempt_jobs(tmp_path):
    api = Api(settings_store=SettingsStore(tmp_path / "settings.json"))
    api.call("start_demo")
    runs = api.call("list_runs", {"provider": "github", "full_name": "acme/payments-api", "status": "failure"})["data"]["runs"]
    run_id = runs[0]["id"]
    api.call("rerun_run", {"provider": "github", "full_name": "acme/payments-api", "run_id": run_id, "failed_only": True})
    attempts = api._demo.list_job_attempts("acme/payments-api", run_id)
    assert {job["attempt"] for job in attempts} == {1, 2}
    assert any(job["attempt"] == 1 and job["state"] == "failure" for job in attempts)


def test_github_and_gitlab_job_attempts():
    def github(request):
        assert request.url.params["filter"] == "all"
        return httpx.Response(200, json={"jobs": [
            {"id": 1, "name": "tests", "status": "completed", "conclusion": "failure", "run_attempt": 1},
            {"id": 2, "name": "tests", "status": "completed", "conclusion": "success", "run_attempt": 2},
        ]})

    service = GitHubService(GitHubClient("t", transport=httpx.MockTransport(github)))
    assert [(job["attempt"], job["state"]) for job in service.list_job_attempts("acme/app", "9")] == [(1, "failure"), (2, "success")]

    def gitlab(request):
        path = request.url.path
        if path.endswith("/projects/group%2Fapp") or path.endswith("/projects/group/app"):
            return httpx.Response(200, json={"id": 7, "path_with_namespace": "group/app", "default_branch": "main", "web_url": "https://gitlab.com/group/app"})
        assert request.url.params["include_retried"] == "true"
        return httpx.Response(200, json=[
            {"id": 12, "name": "tests", "status": "success", "stage": "test"},
            {"id": 10, "name": "tests", "status": "failed", "stage": "test"},
            {"id": 11, "name": "lint", "status": "success", "stage": "test"},
        ])

    service = GitLabService(GitLabClient("t", transport=httpx.MockTransport(gitlab)))
    jobs = service.list_job_attempts("group/app", "5")
    assert [(job["name"], job["attempt"], job["state"]) for job in jobs] == [("tests", 1, "failure"), ("lint", 1, "success"), ("tests", 2, "success")]


@pytest.fixture
def commands(monkeypatch):
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(notifications.subprocess, "run", fake_run)
    return calls


def test_notifier_per_platform(monkeypatch, commands):
    available = {"osascript", "powershell", "notify-send", "gdbus"}
    monkeypatch.setattr(notifications.shutil, "which", lambda name: f"/usr/bin/{name}" if name in available else None)

    result = Notifier(system="darwin").notify("CI a échoué", "acme/app · main")
    assert result == {"delivered": True, "method": "osascript", "reason": None, "error": None}
    assert commands[-1][0][-2:] == ["CI a échoué", "acme/app · main"]  # textes passés en arguments, jamais interprétés

    Notifier(system="win32").notify("Titre", "Corps « spécial » $env:PATH")
    command, kwargs = commands[-1]
    assert command[0].endswith("powershell") and "-Command" in command
    assert kwargs["env"]["EASY_CI_NOTIFICATION_BODY"] == "Corps « spécial » $env:PATH" and "Titre" not in command[-1]

    Notifier(system="linux").notify("Titre", "x" * 1000)
    command, _ = commands[-1]
    assert command[:3] == ["notify-send", "--app-name", "Easy CI"] and len(command[-1]) == notifications.MAX_BODY

    available.discard("notify-send")
    assert Notifier(system="linux").capabilities() == {"supported": True, "method": "gdbus"}
    available.clear()
    assert Notifier(system="linux").notify("Titre")["reason"] == "unsupported"
    assert Notifier(system="emscripten").capabilities() == {"supported": False, "method": None}


def test_notifier_reports_failures(monkeypatch):
    monkeypatch.setattr(notifications.shutil, "which", lambda name: f"/usr/bin/{name}")

    def failing(command, **kwargs):
        raise subprocess.CalledProcessError(1, command, stderr=b"no D-Bus session")

    monkeypatch.setattr(notifications.subprocess, "run", failing)
    result = Notifier(system="linux").notify("Titre", "Corps")
    assert result["delivered"] is False and result["reason"] == "failed" and "D-Bus" in result["error"]


def test_notification_settings_defaults(tmp_path):
    settings = SettingsStore(tmp_path / "settings.json").load()
    assert settings["notifications_enabled"] and settings["notify_failures"] and settings["notify_recoveries"]
    assert settings["notifications_scope"] == "all"
