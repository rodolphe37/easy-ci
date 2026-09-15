"""Notifications système : pipeline passé en échec ou revenu au vert.

L'interface détecte les changements d'état à partir des scans (aucune requête supplémentaire) et
demande au moteur d'afficher la notification avec le mécanisme natif du système :

- macOS : AppleScript (`osascript`), affiché dans le centre de notifications. Le framework
  UserNotifications exige une application signée par un compte développeur Apple, ce que n'est
  pas Easy CI (signature ad hoc) : il répond « Notifications are not allowed for this application » ;
- Windows : notification toast via PowerShell (API Windows.UI.Notifications) ;
- Linux : `notify-send` (libnotify), sinon D-Bus via `gdbus`.

Aucune dépendance obligatoire : sur un système sans mécanisme disponible (navigateur, Linux
minimal), le résultat l'indique et l'interface se rabat sur une notification web.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from easy_ci.local.git import SUBPROCESS_FLAGS
from easy_ci.storage import APP_NAME

log = logging.getLogger(__name__)

ICON = Path(__file__).parent / "resources" / "icon.png"
TIMEOUT = 15
MAX_TITLE = 120
MAX_BODY = 400

# Identifiant d'application de PowerShell : Windows n'affiche les toasts que pour une application
# enregistrée, et Easy CI (archive portable) ne l'est pas.
WINDOWS_APP_ID = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"

_WINDOWS_SCRIPT = """
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $xml.GetElementsByTagName('text')
[void]$texts.Item(0).AppendChild($xml.CreateTextNode($env:EASY_CI_NOTIFICATION_TITLE))
[void]$texts.Item(1).AppendChild($xml.CreateTextNode($env:EASY_CI_NOTIFICATION_BODY))
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:EASY_CI_NOTIFICATION_APP).Show($toast)
"""

_APPLESCRIPT = ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run"]


def _result(delivered: bool, method: str | None, reason: str | None = None, error: str | None = None) -> dict[str, Any]:
    return {"delivered": delivered, "method": method, "reason": reason, "error": error}


def _clip(text: str, limit: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _run(command: list[str], env: dict[str, str] | None = None) -> None:
    subprocess.run(command, check=True, capture_output=True, timeout=TIMEOUT, env=env, **SUBPROCESS_FLAGS)


class Notifier:
    """Envoie les notifications ; `system` est injectable pour les tests."""

    def __init__(self, system: str | None = None) -> None:
        self._system = system or sys.platform

    def capabilities(self) -> dict[str, Any]:
        method = self._method()
        return {"supported": method is not None, "method": method}

    def _method(self) -> str | None:
        if self._system == "darwin":
            return "osascript" if shutil.which("osascript") else None
        if self._system == "win32":
            return "windows" if shutil.which("powershell") or shutil.which("powershell.exe") else None
        if self._system.startswith("linux") or "bsd" in self._system:
            if shutil.which("notify-send"):
                return "notify-send"
            return "gdbus" if shutil.which("gdbus") else None
        return None  # navigateur (Pyodide), système inconnu

    def notify(self, title: str, body: str = "") -> dict[str, Any]:
        """Affiche une notification (quelques dixièmes de seconde, une seconde environ avec PowerShell)."""
        title, body = _clip(title, MAX_TITLE) or APP_NAME, _clip(body, MAX_BODY)
        method = self._method()
        if method is None:
            return _result(False, None, "unsupported")
        try:
            if method == "osascript":
                _run(["osascript", *_APPLESCRIPT, title, body])
            elif method == "windows":
                env = {**os.environ, "EASY_CI_NOTIFICATION_TITLE": title, "EASY_CI_NOTIFICATION_BODY": body, "EASY_CI_NOTIFICATION_APP": WINDOWS_APP_ID}
                _run([shutil.which("powershell") or "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", _WINDOWS_SCRIPT], env)
            elif method == "notify-send":
                _run(["notify-send", "--app-name", APP_NAME, "--icon", str(ICON), title, body])
            else:
                _run([
                    "gdbus", "call", "--session", "--dest", "org.freedesktop.Notifications", "--object-path", "/org/freedesktop/Notifications",
                    "--method", "org.freedesktop.Notifications.Notify", APP_NAME, "0", str(ICON), title, body, "[]", "{}", "8000",
                ])
            return _result(True, method)
        except (OSError, subprocess.SubprocessError) as exc:
            log.warning("Notification %s impossible : %s", method, exc)
            detail = getattr(exc, "stderr", None)
            message = detail.decode(errors="replace").strip() if isinstance(detail, bytes) and detail.strip() else str(exc)
            return _result(False, method, "failed", message[:300])
