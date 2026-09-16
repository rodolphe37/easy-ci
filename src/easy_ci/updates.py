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
from easy_ci.i18n import N_, tr

log = logging.getLogger(__name__)

REPOSITORY = "rodolphe37/easy-ci"
LATEST_RELEASE_API_URL = f"https://api.github.com/repos/{REPOSITORY}/releases/latest"
RELEASES_URL = f"https://github.com/{REPOSITORY}/releases/latest"
INSTALL_SCRIPT_MACOS = f"https://raw.githubusercontent.com/{REPOSITORY}/main/packaging/macos/install.sh"
INSTALL_SCRIPT_LINUX = f"https://raw.githubusercontent.com/{REPOSITORY}/main/packaging/linux/install.sh"
INSTALL_SCRIPT_WINDOWS = f"https://raw.githubusercontent.com/{REPOSITORY}/main/packaging/windows/install.ps1"
REQUEST_TIMEOUT = 8.0
CACHE_SECONDS = 6 * 3600  # l'API GitHub non authentifiée est limitée à 60 requêtes par heure

# Motifs d'échec, traduits au moment de l'affichage et non au moment de l'appel : le résultat
# étant gardé six heures, un message traduit y serait resté figé dans la langue de l'époque.
_ERRORS = {
    "not_found": N_("Aucune version publique trouvée (dépôt privé ou pas encore de version)."),
    "rate_limited": N_("Limite de requêtes GitHub atteinte : nouvel essai plus tard."),
    "unreachable": N_("Vérification impossible (connexion à GitHub)."),
}


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
        # Notes bilingues (bloc français puis anglais) : une limite trop basse couperait le bloc anglais,
        # que l'interface ne pourrait plus extraire. 30 000 caractères laissent une marge confortable.
        "notes": notes[:30000],
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
        script = {"label": tr("Script d'installation"), "command": f"curl -fsSL {INSTALL_SCRIPT_MACOS} | bash"}
        return [brew, script] if method == "homebrew" else [script, brew]
    if system == "Linux":
        return [{"label": tr("Script d'installation"), "command": f"curl -fsSL {INSTALL_SCRIPT_LINUX} | bash"}]
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
            if force or not self._cached or time.time() - self._cached[0] >= CACHE_SECONDS:
                self._cached = (time.time(), self._fetch())
            checked_at, raw = self._cached
        return self._render(raw, checked_at)

    def _fetch(self) -> dict[str, Any]:
        """Appel réseau seul : renvoie un motif d'échec ou la version publiée, sans texte traduit."""
        headers = {"Accept": "application/vnd.github+json", "User-Agent": f"EasyCI/{self.current_version} (update-check)"}
        try:
            with self._client_factory() as client:
                response = client.get(LATEST_RELEASE_API_URL, headers=headers)
            if response.status_code == 404:
                return {"error": "not_found", "latest": None}
            if response.status_code in (403, 429):
                return {"error": "rate_limited", "latest": None}
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            log.info("Vérification des mises à jour impossible : %s", exc)
            return {"error": "unreachable", "latest": None}
        return {"error": None, "latest": parse_latest_release(payload, self.current_version)}

    def _render(self, raw: dict[str, Any], checked_at: float) -> dict[str, Any]:
        """Habille le résultat brut dans la langue courante (l'interface peut en changer entre deux appels)."""
        error = raw.get("error")
        return {
            "current_version": self.current_version,
            "checked_at": checked_at,
            "available": raw.get("latest") is not None,
            "latest": raw.get("latest"),
            "error": tr(_ERRORS[error]) if error else None,
            "releases_url": RELEASES_URL,
            "install_method": install_method(),
            "instructions": upgrade_instructions(),
        }
