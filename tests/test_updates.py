import httpx
import pytest

from easy_ci import updates
from easy_ci.updates import UpdateChecker, install_method, is_newer, parse_latest_release, upgrade_instructions


def test_version_comparison():
    assert is_newer("0.10.0", "0.9.3") and is_newer("v1.0.0", "0.99.0") and is_newer("1.2.1", "1.2")
    assert not is_newer("0.1.0", "0.1.0") and not is_newer("0.1.0-beta.2", "0.1.0") and not is_newer("0.0.9", "0.1.0")


def test_parse_latest_release():
    release = {"tag_name": "v0.3.0", "html_url": "https://github.com/x/y/releases/tag/v0.3.0", "body": "## Nouveautés", "published_at": "2026-09-20T10:00:00Z"}
    assert parse_latest_release(release, "0.2.9") == {"version": "0.3.0", "url": release["html_url"], "published_at": release["published_at"], "notes": "## Nouveautés"}
    assert parse_latest_release(release, "0.3.0") is None
    assert parse_latest_release({**release, "prerelease": True}, "0.1.0") is None
    assert parse_latest_release({"message": "Not Found"}, "0.1.0") is None
    assert parse_latest_release(["unexpected"], "0.1.0") is None
    bilingual = "<!-- lang:fr -->\n" + "- entrée\n" * 800 + "<!-- /lang -->\n\n<!-- lang:en -->\n## What's new\n<!-- /lang -->"
    assert parse_latest_release({**release, "body": bilingual}, "0.2.9")["notes"] == bilingual


def test_install_method_and_instructions(tmp_path, monkeypatch):
    assert install_method("Darwin", frozen=False) == "source"
    assert upgrade_instructions("Darwin", "source")[0]["command"].startswith("git pull")
    mac = upgrade_instructions("Darwin", "homebrew")
    assert mac[0]["command"] == "brew upgrade --cask easy-ci" and "install.sh | bash" in mac[1]["command"]
    assert "install.sh | bash" in upgrade_instructions("Darwin", "script")[0]["command"]
    assert "linux/install.sh" in upgrade_instructions("Linux", "script")[0]["command"]
    assert upgrade_instructions("Windows", "manual")[0]["command"].startswith("irm ")

    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    installed = tmp_path / "easy-ci" / "EasyCI"
    installed.parent.mkdir()
    installed.write_text("")
    assert install_method("Linux", str(installed), frozen=True) == "script"
    assert install_method("Linux", str(tmp_path / "Downloads" / "EasyCI"), frozen=True) == "manual"


def _checker(handler, version="0.1.0"):
    return UpdateChecker(version, client_factory=lambda: httpx.Client(transport=httpx.MockTransport(handler)))


def test_checker_reports_new_version_and_caches():
    calls = []

    def handler(request):
        calls.append(request)
        assert request.headers["User-Agent"].startswith("EasyCI/0.1.0")
        return httpx.Response(200, json={"tag_name": "v0.2.0", "html_url": "https://example.org/r", "body": "notes"})

    checker = _checker(handler)
    result = checker.check()
    assert result["available"] is True and result["latest"]["version"] == "0.2.0" and result["error"] is None
    assert checker.check() is result and len(calls) == 1
    checker.check(force=True)
    assert len(calls) == 2


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (httpx.Response(404, json={"message": "Not Found"}), "Aucune version publique"),
        (httpx.Response(403, json={"message": "rate limit"}), "Limite de requêtes"),
        (httpx.Response(500), "Vérification impossible"),
        (httpx.Response(200, content=b"<html>"), "Vérification impossible"),
    ],
)
def test_checker_is_silent_on_failures(response, message):
    result = _checker(lambda request: response).check()
    assert result["available"] is False and message in result["error"]


def test_checker_network_error():
    def handler(request):
        raise httpx.ConnectError("offline")

    assert _checker(handler).check()["error"].startswith("Vérification impossible")


def test_api_route(tmp_path):
    from easy_ci.api import Api
    from easy_ci.storage import SettingsStore

    class NoCredentials:
        def load(self, provider):
            return None

        def save(self, provider, credentials):
            return True

        def clear(self, provider):
            pass

    checker = _checker(lambda request: httpx.Response(200, json={"tag_name": "v9.0.0"}))
    api = Api(NoCredentials(), SettingsStore(tmp_path / "s.json"), update_checker=checker)
    assert api.call("check_for_update")["data"]["latest"]["version"] == "9.0.0"
    settings = api.call("update_settings", {"changes": {"dismissed_update_version": "9.0.0", "check_updates": False}})["data"]
    assert settings["dismissed_update_version"] == "9.0.0" and settings["check_updates"] is False
    assert updates.RELEASES_URL.endswith("/releases/latest")
