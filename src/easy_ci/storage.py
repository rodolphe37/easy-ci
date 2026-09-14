"""Persistance locale : token dans le trousseau du système, préférences en JSON."""

from __future__ import annotations

import copy
import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

import keyring
from platformdirs import user_config_dir

log = logging.getLogger(__name__)

APP_NAME = "Easy CI"
KEYRING_SERVICE = "easy-ci"
LEGACY_GITHUB_ACCOUNT = "github-token"

DEFAULT_SETTINGS: dict[str, Any] = {
    "theme": "system",  # system | light | dark
    "language": "system",  # system | fr | en
    "refresh_interval": 60,  # secondes, 0 = manuel
    "favorites": [],  # clés « fournisseur:chemin »
    "added_repositories": [],  # dépôts suivis en plus de ceux découverts automatiquement
    "hidden_repositories": [],  # dépôts découverts que l'utilisateur ne veut pas voir
    "show_repos_without_ci": True,
    "include_archived": False,
    # Projets locaux
    "local_roots": [],  # dossiers parcourus pour détecter les clones Git
    "local_links": {},  # clé de dépôt → dossier ; "" = liaison automatique retirée volontairement
    "auto_fetch_minutes": 15,  # 0 = désactivé
    "auto_pull": False,  # mise à jour en avance rapide seulement, si aucune modification locale
    "preferred_editor": None,
    # Mises à jour
    "check_updates": True,  # interroge GitHub au démarrage puis toutes les 6 heures
    "dismissed_update_version": None,  # « Ignorer cette version » : plus de fenêtre pour celle-ci
}

_REPO_LIST_SETTINGS = ("favorites", "added_repositories", "hidden_repositories")

# Identifiants fournis par variables d'environnement (CI, tests, postes sans trousseau).
_ENV_CREDENTIALS = {
    "github": {"token": "EASY_CI_GITHUB_TOKEN"},
    "gitlab": {"token": "EASY_CI_GITLAB_TOKEN", "host": "EASY_CI_GITLAB_URL"},
    "bitbucket": {"email": "EASY_CI_BITBUCKET_EMAIL", "api_token": "EASY_CI_BITBUCKET_API_TOKEN", "access_token": "EASY_CI_BITBUCKET_ACCESS_TOKEN"},
}


class CredentialStore:
    """Identifiants de chaque fournisseur, conservés dans le trousseau du système (JSON par fournisseur)."""

    def load(self, provider: str) -> dict[str, str] | None:
        from_env = _credentials_from_env(provider)
        if from_env:
            return from_env
        try:
            stored = keyring.get_password(KEYRING_SERVICE, f"{provider}-credentials")
            if stored:
                return json.loads(stored)
            if provider == "github":
                legacy = keyring.get_password(KEYRING_SERVICE, LEGACY_GITHUB_ACCOUNT)
                return {"token": legacy} if legacy else None
        except Exception:  # pas de trousseau disponible (Linux minimal, CI…) ou contenu illisible
            log.warning("Trousseau indisponible : identifiants %s non relus.", provider, exc_info=True)
        return None

    def save(self, provider: str, credentials: dict[str, str]) -> bool:
        try:
            keyring.set_password(KEYRING_SERVICE, f"{provider}-credentials", json.dumps(credentials))
            return True
        except Exception:
            log.warning("Trousseau indisponible : identifiants %s conservés pour cette session seulement.", provider, exc_info=True)
            return False

    def clear(self, provider: str) -> None:
        accounts = [f"{provider}-credentials"] + ([LEGACY_GITHUB_ACCOUNT] if provider == "github" else [])
        for account in accounts:
            try:
                keyring.delete_password(KEYRING_SERVICE, account)
            except Exception:
                pass


def _credentials_from_env(provider: str) -> dict[str, str] | None:
    values = {key: os.environ[var] for key, var in _ENV_CREDENTIALS.get(provider, {}).items() if os.environ.get(var)}
    if provider == "bitbucket":
        complete = "access_token" in values or {"email", "api_token"} <= values.keys()
    else:
        complete = "token" in values
    return values if complete else None


def _same_kind(default: Any, value: Any) -> bool:
    """Ignore une valeur stockée dont le type ne correspond plus (fichier modifié à la main, ancienne version)."""
    if default is None or value is None:
        return True
    if isinstance(default, bool):
        return isinstance(value, bool)
    if isinstance(default, (int, float)):
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, type(default))


def _normalize_repo_lists(settings: dict[str, Any]) -> dict[str, Any]:
    for key in _REPO_LIST_SETTINGS:
        settings[key] = list(dict.fromkeys(_with_provider_prefix(item) for item in settings.get(key, []) if isinstance(item, str)))
    return settings


def _with_provider_prefix(key: str) -> str:
    """Les préférences antérieures au multi-fournisseur ne stockaient que « propriétaire/dépôt » (GitHub)."""
    provider, sep, _ = key.partition(":")
    return key if sep and provider in ("github", "gitlab", "bitbucket") else f"github:{key}"


class SettingsStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or Path(user_config_dir(APP_NAME, appauthor=False)) / "settings.json"
        self._lock = threading.Lock()

    def load(self) -> dict[str, Any]:
        try:
            stored = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            stored = {}
        settings = copy.deepcopy(DEFAULT_SETTINGS)
        settings.update({k: v for k, v in stored.items() if k in DEFAULT_SETTINGS and _same_kind(DEFAULT_SETTINGS[k], v)})
        return _normalize_repo_lists(settings)

    def update(self, changes: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            settings = self.load()
            accepted = {k: v for k, v in changes.items() if k in DEFAULT_SETTINGS and _same_kind(DEFAULT_SETTINGS[k], v)}
            settings = _normalize_repo_lists({**settings, **accepted})
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8")
            return settings
