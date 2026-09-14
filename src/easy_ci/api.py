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
from easy_ci.generation.detect import detect as detect_stack
from easy_ci.generation.render import choices as pipeline_choices
from easy_ci.generation.render import default_options as default_pipeline_options
from easy_ci.generation.render import generate as generate_pipeline
from easy_ci.github.client import GitHubClient
from easy_ci.github.service import GitHubService
from easy_ci.gitlab.service import GitLabClient, GitLabService, normalize_host
from easy_ci.local.demo import DemoLocalProjects
from easy_ci.local.git import SUBPROCESS_FLAGS
from easy_ci.local.service import LocalProjectsService
from easy_ci.providers import GITHUB, GITLAB, PROVIDER_INFO, PROVIDERS, repo_key, split_repo_key
from easy_ci.refs import parse_repository_reference
from easy_ci.storage import CredentialStore, SettingsStore
from easy_ci.updates import UpdateChecker
from easy_ci.validation import validate as validate_ci
from easy_ci.workflow_yaml import summarize as summarize_ci

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
        update_checker: UpdateChecker | None = None,
    ) -> None:
        self._credentials = credential_store or CredentialStore()
        self._settings = settings_store or SettingsStore()
        self._factories = {**DEFAULT_FACTORIES, **(factories or {})}
        self._accounts: dict[str, Account] = {}
        self._restore_errors: dict[str, str] = {}
        self._demo: DemoService | None = None
        self._lock = threading.RLock()
        self._local = LocalProjectsService(self._settings, gitlab_hosts=self._gitlab_hosts)
        self._demo_local: DemoLocalProjects | None = None
        self._updates = update_checker or UpdateChecker()

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
            "check_for_update": lambda force=False: self._updates.check(bool(force)),
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
            # Projets locaux
            "local_overview": lambda: self._local_projects().overview(),
            "scan_local_projects": lambda: self._local_projects().scan(),
            "add_local_root": lambda path: self._local_projects().add_root(path),
            "remove_local_root": lambda path: self._local_projects().remove_root(path),
            "pick_folder": lambda title="Choisir un dossier": self._local_projects().pick_folder(title),
            "link_local_project": lambda key, path, force=False: self._local_projects().link(key, path, bool(force)),
            "unlink_local_project": lambda key: self._local_projects().unlink(key),
            "clone_repository": self.clone_repository,
            "get_local_status": lambda key: self._local_projects().status(key),
            "sync_local_project": lambda key, pull=False: self._local_projects().sync(key, bool(pull)),
            "get_local_ci_diff": lambda key, path: self._local_projects().ci_diff(key, path),
            "open_local_project": lambda key, target, editor_id=None: self._local_projects().open(key, target, editor_id),
            # Édition des fichiers CI (dans le clone local)
            "validate_ci": lambda provider, content: validate_ci(provider, content),
            "summarize_ci": lambda provider, content: summarize_ci(provider, content),
            "lint_ci_remote": self.lint_ci_remote,
            "read_ci_file": lambda key, path: self._local_projects().read_ci_file(key, path),
            "save_ci_file": lambda key, path, content, expected_hash=None, overwrite=False: self._local_projects().save_ci_file(key, path, content, expected_hash, bool(overwrite)),
            "discard_ci_file": lambda key, path: self._local_projects().discard_ci_file(key, path),
            "branch_suggestion": lambda key, path=None: self._local_projects().branch_suggestion(key, path),
            "commit_ci": lambda key, paths, message, new_branch=None: self._local_projects().commit_ci(key, list(paths), message, new_branch),
            "push_local_branch": lambda key: self._local_projects().push(key),
            "get_publication": self.get_publication,
            # Génération de pipelines (modèles, sans IA)
            "detect_project": self.detect_project,
            "generate_pipeline": self.generate_pipeline,
            "create_pull_request": self.create_pull_request,
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

    # -- Projets locaux ---------------------------------------------------

    def set_folder_picker(self, picker: Callable[[str], str | None] | None) -> None:
        self._local.set_folder_picker(picker)

    def _local_projects(self) -> Any:
        return self._demo_local if self._demo is not None and self._demo_local is not None else self._local

    def _gitlab_hosts(self) -> tuple[str, ...]:
        return tuple(a.host for a in self._accounts.values() if a.provider == GITLAB and a.host)

    def clone_repository(self, key: str, parent: str, protocol: str = "https") -> dict[str, Any]:
        provider, _ = split_repo_key(key)
        account = self._accounts.get(provider)
        return self._local_projects().clone(key, parent, protocol, account.host if account else None)

    def lint_ci_remote(self, key: str, content: str) -> dict[str, Any]:
        provider, full_name = split_repo_key(key)
        service = self._service(provider)
        if not hasattr(service, "lint_ci") or (self._demo is None and provider != GITLAB):
            raise EasyCIError("La validation officielle n'est disponible que pour GitLab (CI Lint).")
        return service.lint_ci(full_name, content)

    def detect_project(self, key: str) -> dict[str, Any]:
        """Analyse le clone local et propose une configuration de départ pour l'assistant."""
        provider, full_name = split_repo_key(key)
        local = self._local_projects()
        detection = detect_stack(local.project_files(key))
        try:
            default_branch = local.branch_suggestion(key, None).get("default_branch") or "main"
        except EasyCIError:
            default_branch = "main"
        return {
            "provider": provider,
            "detection": detection,
            "options": default_pipeline_options(provider, detection, default_branch, full_name),
            "choices": pipeline_choices(provider),
        }

    def generate_pipeline(self, key: str, options: dict[str, Any]) -> dict[str, Any]:
        """Rendu du fichier (aperçu) ; l'écriture passe ensuite par save_ci_file, comme une édition."""
        provider, _ = split_repo_key(key)
        result = generate_pipeline(provider, options)
        existing = self._local_projects().read_ci_file(key, result["path"])
        return {**result, "exists": existing["exists"], "existing_hash": existing["hash"], "branch": existing["branch"]}

    def get_publication(self, key: str) -> dict[str, Any]:
        """Où en est la branche locale : envoyée ou non, pull request existante, branche cible par défaut."""
        provider, full_name = split_repo_key(key)
        status = self._local_projects().status(key)
        if not status.get("linked") or status.get("error"):
            return {"available": False}
        branch = status.get("branch")
        pushed = bool(status.get("upstream")) and status.get("ahead", 0) == 0
        publication: dict[str, Any] = {
            "available": True,
            "branch": branch,
            "upstream": status.get("upstream"),
            "ahead": status.get("ahead", 0),
            "pushed": pushed,
            "pull_request": None,
            "default_branch": None,
            "account_connected": self._demo is not None or provider in self._accounts,
            "pull_request_error": None,
        }
        if not publication["account_connected"] or not branch:
            return publication
        service = self._service(provider)
        try:
            publication["default_branch"] = service.get_repository(full_name).get("default_branch")
            if status.get("upstream"):
                publication["pull_request"] = service.find_pull_request(full_name, branch)
        except (NotFoundError, ForbiddenError, NetworkError) as exc:
            publication["pull_request_error"] = str(exc)
        return publication

    def create_pull_request(self, key: str, title: str, body: str = "", base: str | None = None, draft: bool = False) -> dict[str, Any]:
        provider, full_name = split_repo_key(key)
        title = title.strip()
        if not title:
            raise EasyCIError("Saisissez un titre.")
        status = self._local_projects().status(key)
        branch = status.get("branch")
        if not branch:
            raise EasyCIError("Aucune branche locale : impossible de créer une pull request.")
        if not status.get("upstream") or status.get("ahead", 0) > 0:
            raise EasyCIError("Envoyez d'abord la branche (bouton « Envoyer ») pour que la plateforme connaisse vos commits.")
        service = self._service(provider)
        base = base or service.get_repository(full_name).get("default_branch")
        if base == branch:
            raise EasyCIError(f"La branche « {branch} » est déjà la branche cible : créez une branche dédiée pour proposer une modification.")
        existing = service.find_pull_request(full_name, branch)
        if existing:
            return {**existing, "already_existed": True}
        return {**service.create_pull_request(full_name, branch, base, title, body, bool(draft)), "already_existed": False}

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
        result = subprocess.run([gh, "auth", "token"], capture_output=True, text=True, timeout=10, **SUBPROCESS_FLAGS)
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
            self._demo_local = DemoLocalProjects(self._demo)
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
            self._demo_local = None

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
