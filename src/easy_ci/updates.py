"""Détection d'une nouvelle version publiée.

Même source de vérité que les scripts d'installation et le cask Homebrew : l'API « latest release »
de GitHub. Une version signalée est donc toujours une version réellement publiée, avec ses
fichiers téléchargeables (les pré-versions et brouillons sont exclus par cette API).

Volontairement silencieux en cas d'échec (hors ligne, dépôt inaccessible, quota, réponse
inattendue) : c'est une information, jamais une erreur à afficher au démarrage.
"""

from __future__ import annotations

import logging
import os
import platform
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any

import httpx

from easy_ci import __version__
from easy_ci.i18n import tr

log = logging.getLogger(__name__)

REPOSITORY = "rodolphe37/easy-ci"
LATEST_RELEASE_API_URL = f"https://api.github.com/repos/{REPOSITORY}/releases/latest"
RELEASES_URL = f"https://github.com/{REPOSITORY}/releases/latest"
INSTALL_SCRIPT_MACOS = f"https://raw.githubusercontent.com/{REPOSITORY}/main/packaging/macos/install.sh"
INSTALL_SCRIPT_LINUX = f"https://raw.githubusercontent.com/{REPOSITORY}/main/packaging/linux/install.sh"
INSTALL_SCRIPT_WINDOWS = f"https://raw.githubusercontent.com/{REPOSITORY}/main/packaging/windows/install.ps1"
REQUEST_TIMEOUT = 8.0
CACHE_SECONDS = 6 * 3600  # l'API GitHub non authentifiée est limitée à 60 requêtes par heure


def parse_version(version: str) -> tuple[int, ...]:
    """« 1.10.2 » → (1, 10, 2). Segments non numériques comptés comme 0 ; suffixe « -beta » ignoré."""
    parts = []
    for segment in version.strip().removeprefix("v").split("-", 1)[0].split("."):
        match = re.match(r"\d+", segment)
        parts.append(int(match.group()) if match else 0)
    return tuple(parts)


def is_newer(candidate: str, baseline: str) -> bool:
    return parse_version(candidate) > parse_version(baseline)


def parse_latest_release(payload: Any, current_version: str) -> dict[str, Any] | None:
    """Partie pure du traitement de la réponse : la version publiée si elle est plus récente, sinon None."""
    if not isinstance(payload, dict) or not isinstance(payload.get("tag_name"), str):
        return None
    if payload.get("draft") or payload.get("prerelease"):
        return None
    latest = payload["tag_name"].removeprefix("v")
    if not is_newer(latest, current_version):
        return None
    notes = payload.get("body") if isinstance(payload.get("body"), str) else ""
    return {
        "version": latest,
        "url": payload.get("html_url") or RELEASES_URL,
        "published_at": payload.get("published_at"),
        "notes": notes[:4000],
    }


def install_method(system: str | None = None, executable: str | None = None, frozen: bool | None = None) -> str:
    """Comment cette copie d'Easy CI a été installée : homebrew, script, manual (zip) ou source."""
    system = system or platform.system()
    executable = executable or sys.executable
    if not (getattr(sys, "frozen", False) if frozen is None else frozen):
        return "source"
    if system == "Darwin":
        caskrooms = [Path("/opt/homebrew/Caskroom/easy-ci"), Path("/usr/local/Caskroom/easy-ci")]
        return "homebrew" if any(path.is_dir() for path in caskrooms) else "script"
    if system == "Linux":
        data_home = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
        return "script" if str(Path(executable).resolve()).startswith(str((data_home / "easy-ci").resolve())) else "manual"
    if system == "Windows":
        local = os.environ.get("LOCALAPPDATA", "")
        return "script" if local and str(Path(executable).resolve()).lower().startswith(str(Path(local, "Programs", "EasyCI").resolve()).lower()) else "manual"
    return "manual"


def upgrade_instructions(system: str | None = None, method: str | None = None) -> list[dict[str, str]]:
    """Commandes de mise à jour à proposer, la plus adaptée à l'installation actuelle en premier."""
    system = system or platform.system()
    method = method or install_method(system)
    if method == "source":
        return [{"label": tr("Depuis les sources"), "command": "git pull && pip install -e . && npm --prefix frontend run build"}]
    if system == "Darwin":
        brew = {"label": "Homebrew", "command": "brew upgrade --cask easy-ci"}
        script = {"label": "Script d'installation", "command": f"curl -fsSL {INSTALL_SCRIPT_MACOS} | bash"}
        return [brew, script] if method == "homebrew" else [script, brew]
    if system == "Linux":
        return [{"label": "Script d'installation", "command": f"curl -fsSL {INSTALL_SCRIPT_LINUX} | bash"}]
    if system == "Windows":
        return [{"label": "PowerShell", "command": f"irm {INSTALL_SCRIPT_WINDOWS} | iex"}]
    return []


class UpdateChecker:
    def __init__(self, current_version: str = __version__, client_factory: Any = None) -> None:
        self.current_version = current_version
        self._client_factory = client_factory or (lambda: httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=True))
        self._lock = threading.Lock()
        self._cached: tuple[float, dict[str, Any]] | None = None

    def check(self, force: bool = False) -> dict[str, Any]:
        with self._lock:
            if not force and self._cached and time.time() - self._cached[0] < CACHE_SECONDS:
                return self._cached[1]
            result = self._fetch()
            self._cached = (time.time(), result)
            return result

    def _fetch(self) -> dict[str, Any]:
        base: dict[str, Any] = {
            "current_version": self.current_version,
            "checked_at": time.time(),
            "available": False,
            "latest": None,
            "error": None,
            "releases_url": RELEASES_URL,
            "install_method": install_method(),
            "instructions": upgrade_instructions(),
        }
        headers = {"Accept": "application/vnd.github+json", "User-Agent": f"EasyCI/{self.current_version} (update-check)"}
        try:
            with self._client_factory() as client:
                response = client.get(LATEST_RELEASE_API_URL, headers=headers)
            if response.status_code == 404:
                return {**base, "error": tr("Aucune version publique trouvée (dépôt privé ou pas encore de version).")}
            if response.status_code in (403, 429):
                return {**base, "error": tr("Limite de requêtes GitHub atteinte : nouvel essai plus tard.")}
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            log.info("Vérification des mises à jour impossible : %s", exc)
            return {**base, "error": tr("Vérification impossible (connexion à GitHub).")}
        latest = parse_latest_release(payload, self.current_version)
        return {**base, "available": latest is not None, "latest": latest}
