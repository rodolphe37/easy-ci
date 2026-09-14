"""Point d'entrée unique appelé par l'interface (pont pywebview ou serveur de dev).

Chaque appel renvoie une enveloppe JSON : {"ok": true, "data": …} ou
{"ok": false, "error": {"code": …, "message": …}}.

Plusieurs comptes peuvent être connectés en même temps (un par fournisseur) ;
les opérations sur un dépôt précisent le fournisseur concerné.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import threading
import webbrowser
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from easy_ci import __version__
from easy_ci.bitbucket.service import BitbucketClient, BitbucketService
from easy_ci.demo import DemoService
from easy_ci.errors import AuthError, EasyCIError, ForbiddenError, NetworkError, NotAuthenticatedError, NotFoundError
from easy_ci.github.client import GitHubClient
from easy_ci.github.service import GitHubService
from easy_ci.gitlab.service import GitLabClient, GitLabService, normalize_host
from easy_ci.providers import GITHUB, GITLAB, PROVIDER_INFO, PROVIDERS, repo_key, split_repo_key
from easy_ci.refs import parse_repository_reference
from easy_ci.storage import CredentialStore, SettingsStore

log = logging.getLogger(__name__)

ServiceFactory = Callable[[dict[str, str]], Any]


def _github(credentials: dict[str, str]) -> GitHubService:
    return GitHubService(GitHubClient(credentials["token"]))


def _gitlab(credentials: dict[str, str]) -> GitLabService:
    return GitLabService(GitLabClient(credentials["token"], host=credentials.get("host") or "https://gitlab.com"))


def _bitbucket(credentials: dict[str, str]) -> BitbucketService:
    return BitbucketService(
        BitbucketClient(email=credentials.get("email"), api_token=credentials.get("api_token"), access_token=credentials.get("access_token"))
    )


DEFAULT_FACTORIES: dict[str, ServiceFactory] = {"github": _github, "gitlab": _gitlab, "bitbucket": _bitbucket}

_REQUIRED_FIELDS = {
    "github": (("token",), "Saisissez un token GitHub."),
    "gitlab": (("token",), "Saisissez un token GitLab."),
    "bitbucket": ((), ""),
}

_PROVIDER_NAMES = {provider: info["label"] for provider, info in PROVIDER_INFO.items()}


@dataclass
class Account:
    provider: str
    service: Any
    user: dict[str, Any]
    persisted: bool
    host: str | None = None


class Api:
    def __init__(
        self,
        credential_store: CredentialStore | None = None,
        settings_store: SettingsStore | None = None,
        factories: dict[str, ServiceFactory] | None = None,
    ) -> None:
        self._credentials = credential_store or CredentialStore()
        self._settings = settings_store or SettingsStore()
        self._factories = {**DEFAULT_FACTORIES, **(factories or {})}
        self._accounts: dict[str, Account] = {}
        self._restore_errors: dict[str, str] = {}
        self._demo: DemoService | None = None
        self._lock = threading.RLock()

        def repo(method: str) -> Callable[..., Any]:
            return lambda provider, full_name, **kwargs: getattr(self._service(provider), method)(full_name, **kwargs)

        self._handlers: dict[str, Callable[..., Any]] = {
            "ping": lambda: "pong",
            "get_session": self.get_session,
            "connect_account": self.connect_account,
            "disconnect_account": self.disconnect_account,
            "login": lambda token: self.connect_account(GITHUB, {"token": token}),
            "login_with_gh_cli": self.login_with_gh_cli,
            "start_demo": self.start_demo,
            "logout": self.logout,
            "get_settings": self._settings.load,
            "update_settings": lambda changes: self._settings.update(changes),
            "open_external": self.open_external,
            "get_rate_limits": self.get_rate_limits,
            "list_repositories": self.list_repositories,
            "add_repository": self.add_repository,
            "remove_repository": self.remove_repository,
            "scan_repository": repo("scan_repository"),
            "get_repository": repo("get_repository"),
            "list_runs": repo("list_runs"),
            "get_run": lambda provider, full_name, run_id: self._service(provider).get_run(full_name, str(run_id)),
            "get_job_log": lambda provider, full_name, job_id: self._service(provider).get_job_log(full_name, str(job_id)),
            "get_job_annotations": lambda provider, full_name, job_id: self._service(provider).get_job_annotations(full_name, str(job_id)),
            "get_workflow_file": lambda provider, full_name, path, ref=None: self._service(provider).get_workflow_file(full_name, path, ref),
            "rerun_run": lambda provider, full_name, run_id, failed_only=False: self._service(provider).rerun_run(full_name, str(run_id), bool(failed_only)),
            "cancel_run": lambda provider, full_name, run_id: self._service(provider).cancel_run(full_name, str(run_id)),
        }

    # -- Dispatch ---------------------------------------------------------

    def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        handler = self._handlers.get(method)
        if handler is None:
            return {"ok": False, "error": {"code": "unknown_method", "message": f"Méthode inconnue : {method}"}}
        params = params or {}
        try:
            return {"ok": True, "data": handler(**params)}
        except EasyCIError as exc:
            provider = params.get("provider")
            if isinstance(exc, AuthError) and method not in ("connect_account", "login") and provider in self._accounts:
                # Identifiants révoqués ou expirés en cours de session : ce compte est déconnecté.
                log.info("Identifiants %s refusés, compte déconnecté.", provider)
                self.disconnect_account(provider)
                return {"ok": False, "error": {**exc.to_dict(), "provider": provider}}
            return {"ok": False, "error": exc.to_dict()}
        except TypeError as exc:
            log.exception("Paramètres invalides pour %s", method)
            return {"ok": False, "error": {"code": "bad_request", "message": str(exc)}}
        except Exception as exc:  # garde-fou : l'interface doit toujours recevoir une réponse
            log.exception("Erreur inattendue dans %s", method)
            return {"ok": False, "error": {"code": "internal", "message": f"Erreur inattendue : {exc}"}}

    # -- Comptes ----------------------------------------------------------

    def _service(self, provider: str) -> Any:
        if provider not in PROVIDERS:
            raise EasyCIError(f"Fournisseur inconnu : {provider}")
        if self._demo is not None:
            return self._demo
        account = self._accounts.get(provider)
        if account is None:
            raise NotAuthenticatedError(f"Aucun compte {_PROVIDER_NAMES[provider]} connecté.")
        return account.service

    def _session(self) -> dict[str, Any]:
        if self._demo is not None:
            demo_user = self._demo.get_user()
            accounts = [{"provider": p, "user": demo_user, "persisted": False, "host": PROVIDER_INFO[p]["default_host"]} for p in PROVIDERS]
        else:
            accounts = [
                {"provider": a.provider, "user": a.user, "persisted": a.persisted, "host": a.host or PROVIDER_INFO[a.provider]["default_host"]}
                for a in sorted(self._accounts.values(), key=lambda a: PROVIDERS.index(a.provider))
            ]
        return {
            "authenticated": bool(accounts),
            "mode": "demo" if self._demo is not None else ("live" if accounts else None),
            "accounts": accounts,
            "user": accounts[0]["user"] if accounts else None,
            "restore_errors": [{"provider": p, "message": m} for p, m in self._restore_errors.items()],
            "gh_cli_available": shutil.which("gh") is not None,
            "providers": PROVIDER_INFO,
            "app_version": __version__,
        }

    def get_session(self) -> dict[str, Any]:
        with self._lock:
            if self._demo is None:
                self._restore_accounts()
            return self._session()

    def _restore_accounts(self) -> None:
        for provider in PROVIDERS:
            if provider in self._accounts:
                continue
            credentials = self._credentials.load(provider)
            if not credentials:
                continue
            try:
                self._open_account(provider, credentials, persisted=True)
                self._restore_errors.pop(provider, None)
            except AuthError:
                self._credentials.clear(provider)
                self._restore_errors[provider] = f"Les identifiants {_PROVIDER_NAMES[provider]} ont expiré ou ont été révoqués. Reconnectez le compte."
            except (NetworkError, EasyCIError) as exc:
                # Identifiants conservés : une nouvelle tentative aura lieu au prochain chargement.
                self._restore_errors[provider] = str(exc)

    def connect_account(self, provider: str, credentials: dict[str, Any]) -> dict[str, Any]:
        if provider not in PROVIDERS:
            raise EasyCIError(f"Fournisseur inconnu : {provider}")
        cleaned = {key: str(value).strip() for key, value in credentials.items() if value is not None and str(value).strip()}
        required, message = _REQUIRED_FIELDS[provider]
        if any(field not in cleaned for field in required):
            raise AuthError(message)
        if provider == "bitbucket" and "access_token" not in cleaned and not {"email", "api_token"} <= cleaned.keys():
            raise AuthError("Saisissez l'e-mail de votre compte Atlassian et un API token (ou un access token).")
        if provider == GITLAB:
            cleaned["host"] = normalize_host(cleaned.get("host"))

        with self._lock:
            self._close_demo()
            self._open_account(provider, cleaned, persisted=False)
            self._accounts[provider].persisted = self._credentials.save(provider, cleaned)
            self._restore_errors.pop(provider, None)
            return self._session()

    def _open_account(self, provider: str, credentials: dict[str, str], persisted: bool) -> None:
        service = self._factories[provider](credentials)
        try:
            user = service.get_user()
        except Exception:
            service.close()
            raise
        previous = self._accounts.get(provider)
        if previous is not None:
            previous.service.close()
        self._accounts[provider] = Account(provider, service, user, persisted, credentials.get("host"))

    def disconnect_account(self, provider: str) -> dict[str, Any]:
        with self._lock:
            account = self._accounts.pop(provider, None)
            if account is not None:
                account.service.close()
            self._credentials.clear(provider)
            self._restore_errors.pop(provider, None)
            return self._session()

    def login_with_gh_cli(self) -> dict[str, Any]:
        gh = shutil.which("gh")
        if not gh:
            raise AuthError("GitHub CLI (gh) n'est pas installé.")
        result = subprocess.run([gh, "auth", "token"], capture_output=True, text=True, timeout=10)
        token = result.stdout.strip()
        if result.returncode != 0 or not token:
            raise AuthError("GitHub CLI n'est pas connecté. Lancez « gh auth login » puis réessayez.")
        return self.connect_account(GITHUB, {"token": token})

    def start_demo(self) -> dict[str, Any]:
        with self._lock:
            for account in self._accounts.values():
                account.service.close()
            self._accounts.clear()
            self._restore_errors.clear()
            self._demo = DemoService()
            return self._session()

    def logout(self) -> dict[str, Any]:
        """Quitte la démo ou déconnecte tous les comptes."""
        with self._lock:
            if self._demo is not None:
                self._close_demo()
                return self._session()
            for provider in list(self._accounts):
                self.disconnect_account(provider)
            return self._session()

    def _close_demo(self) -> None:
        if self._demo is not None:
            self._demo.close()
            self._demo = None

    def get_rate_limits(self) -> list[dict[str, Any]]:
        limits = []
        for provider, account in self._accounts.items():
            rate = account.service.rate_limit()
            if rate:
                limits.append({"provider": provider, **rate})
        return limits

    # -- Dépôts suivis ----------------------------------------------------

    def list_repositories(self, provider: str) -> list[dict[str, Any]]:
        """Dépôts découverts automatiquement, complétés par ceux ajoutés à la main."""
        service = self._service(provider)
        repositories = [repo for repo in service.list_repositories() if repo["provider"] == provider]
        known = {repo["full_name"].lower() for repo in repositories}
        for key in self._settings.load()["added_repositories"]:
            added_provider, full_name = split_repo_key(key)
            if added_provider != provider or full_name.lower() in known:
                continue
            try:
                repositories.append({**service.get_repository(full_name), "added_manually": True})
            except (NotFoundError, ForbiddenError):
                log.info("Dépôt ajouté inaccessible, ignoré : %s", key)
        return repositories

    def add_repository(self, reference: str, provider: str | None = None) -> dict[str, Any]:
        gitlab_hosts = tuple(a.host for a in self._accounts.values() if a.provider == GITLAB and a.host)
        provider, full_name = parse_repository_reference(reference, provider, gitlab_hosts)
        service = self._service(provider)
        try:
            repository = service.get_repository(full_name)
        except (NotFoundError, ForbiddenError) as exc:
            hint = "" if self._demo is not None else " Vérifiez l'orthographe et que vos identifiants donnent accès à ce dépôt."
            raise EasyCIError(f"Dépôt « {full_name} » introuvable ou inaccessible sur {_PROVIDER_NAMES[provider]}.{hint}") from exc
        if repository.get("provider", provider) != provider:
            raise EasyCIError(f"« {full_name} » n'est pas un dépôt {_PROVIDER_NAMES[provider]}.")

        key = repo_key(provider, repository["full_name"])
        settings = self._settings.load()
        added = [item for item in settings["added_repositories"] if item.lower() != key.lower()]
        hidden = [item for item in settings["hidden_repositories"] if item.lower() != key.lower()]
        settings = self._settings.update({"added_repositories": [*added, key], "hidden_repositories": hidden})
        return {"repository": {**repository, "added_manually": True}, "settings": settings}

    def remove_repository(self, key: str) -> dict[str, Any]:
        provider, full_name = split_repo_key(key)
        target = repo_key(provider, full_name).lower()
        settings = self._settings.load()
        return self._settings.update({"added_repositories": [item for item in settings["added_repositories"] if item.lower() != target]})

    # -- Divers -----------------------------------------------------------

    @staticmethod
    def open_external(url: str) -> bool:
        if not url.startswith(("https://", "http://")):
            raise EasyCIError("Seuls les liens web peuvent être ouverts.")
        return webbrowser.open(url)
