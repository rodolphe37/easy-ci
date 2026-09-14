"""Projets locaux : détection des clones, liaison avec les dépôts suivis, état Git, récupération.

Principe : Easy CI travaille sur la copie locale de chaque dépôt. Les modifications de CI
(étapes suivantes) seront écrites et commitées localement ; rien n'est poussé sans action
explicite de l'utilisateur.
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from easy_ci.errors import EasyCIError, FileConflictError, LinkMismatchError
from easy_ci.local import git, opener
from easy_ci.local.remotes import clone_urls, match_remote
from easy_ci.providers import BITBUCKET, GITLAB, split_repo_key
from easy_ci.storage import SettingsStore

# Dossiers jamais parcourus lors de la détection (volumineux ou sans intérêt).
_SKIPPED_DIRS = {
    "node_modules", ".venv", "venv", "env", "__pycache__", ".git", ".hg", ".svn", "dist", "build", "target", "vendor",
    ".next", ".nuxt", ".cache", ".gradle", ".idea", ".vscode", "Library", "Pods", "DerivedData", ".Trash", "site-packages",
}
MAX_SCAN_DEPTH = 6
MAX_CHANGES = 200

CI_PATTERNS = {
    "github": [".github/workflows/*.yml", ".github/workflows/*.yaml"],
    GITLAB: [".gitlab-ci.yml", ".gitlab/ci/*.yml", ".gitlab/ci/*.yaml"],
    BITBUCKET: ["bitbucket-pipelines.yml"],
}


def _expand(path: str) -> Path:
    return Path(os.path.expandvars(path)).expanduser().resolve()


def _display_path(path: Path | str) -> str:
    """« /Users/marie/dev/app » → « ~/dev/app »."""
    text = str(path)
    home = str(Path.home())
    return "~" + text[len(home) :] if text == home or text.startswith(home + os.sep) else text


class LocalProjectsService:
    def __init__(
        self,
        settings: SettingsStore,
        gitlab_hosts: Callable[[], tuple[str, ...]] = tuple,
        folder_picker: Callable[[str], str | None] | None = None,
    ) -> None:
        self._settings = settings
        self._gitlab_hosts = gitlab_hosts
        self._folder_picker = folder_picker
        self._lock = threading.Lock()
        # Résultat du dernier scan : clé de dépôt → dossiers trouvés.
        self._discovered: dict[str, list[str]] = {}
        self._unmatched: list[dict[str, Any]] = []
        self._scanned_at: float | None = None
        self._scanning = False

    def set_folder_picker(self, picker: Callable[[str], str | None] | None) -> None:
        self._folder_picker = picker

    # -- Vue d'ensemble ---------------------------------------------------

    def overview(self) -> dict[str, Any]:
        settings = self._settings.load()
        with self._lock:
            discovered = {key: list(paths) for key, paths in self._discovered.items()}
            unmatched = list(self._unmatched)
            scanned_at = self._scanned_at
        links = settings["local_links"]
        projects: dict[str, dict[str, Any]] = {}
        for key, paths in discovered.items():
            if links.get(key) == "":
                continue  # liaison retirée volontairement
            projects[key] = {"key": key, "path": paths[0], "source": "scan", "candidates": paths}
        for key, path in links.items():
            if path:
                candidates = discovered.get(key, [])
                projects[key] = {"key": key, "path": path, "source": "manual", "candidates": sorted({path, *candidates})}
        for project in projects.values():
            project["display_path"] = _display_path(project["path"])
            project["exists"] = Path(project["path"]).is_dir()
        return {
            "git_version": git.git_version(),
            "roots": [{"path": root, "display_path": _display_path(root), "exists": Path(root).is_dir()} for root in settings["local_roots"]],
            "projects": sorted(projects.values(), key=lambda p: p["key"]),
            "unmatched": unmatched[:50],
            "scanned_at": scanned_at,
            "scanning": self._scanning,
            "picker_available": self._folder_picker is not None,
            "editors": opener.available_editors(),
            "file_manager": opener.file_manager_label(),
        }

    def project_path(self, key: str) -> Path | None:
        return next((Path(p["path"]) for p in self.overview()["projects"] if p["key"] == key), None)

    # -- Dossiers racines & détection -------------------------------------

    def pick_folder(self, title: str = "Choisir un dossier") -> str | None:
        if self._folder_picker is None:
            raise EasyCIError("La sélection de dossier n'est disponible que dans l'application desktop : saisissez le chemin.")
        return self._folder_picker(title)

    def add_root(self, path: str) -> dict[str, Any]:
        root = _expand(path)
        if not root.is_dir():
            raise EasyCIError(f"Le dossier « {path} » n'existe pas.")
        if root == Path(root.anchor):
            raise EasyCIError("Choisissez un dossier de projets plutôt que la racine du disque.")
        settings = self._settings.load()
        roots = [r for r in settings["local_roots"] if Path(r) != root]
        self._settings.update({"local_roots": [*roots, str(root)]})
        return self.scan()

    def remove_root(self, path: str) -> dict[str, Any]:
        settings = self._settings.load()
        self._settings.update({"local_roots": [r for r in settings["local_roots"] if r != path]})
        return self.scan()

    def scan(self) -> dict[str, Any]:
        """Parcourt les dossiers racines à la recherche de clones Git et les rapproche des dépôts connus."""
        settings = self._settings.load()
        discovered: dict[str, list[str]] = {}
        unmatched: list[dict[str, Any]] = []
        self._scanning = True
        try:
            for repo_dir in self._find_git_repos([Path(r) for r in settings["local_roots"]]):
                remotes = git.remote_urls(repo_dir)
                matched = self._match(remotes)
                if matched:
                    discovered.setdefault(matched, []).append(str(repo_dir))
                elif len(unmatched) < 200:
                    unmatched.append({"path": str(repo_dir), "display_path": _display_path(repo_dir), "remotes": list(remotes.values())[:3]})
        finally:
            self._scanning = False
        # Plusieurs clones du même dépôt : le plus récemment modifié en premier.
        for paths in discovered.values():
            paths.sort(key=lambda p: _mtime(Path(p)), reverse=True)
        with self._lock:
            self._discovered, self._unmatched, self._scanned_at = discovered, unmatched, time.time()
        return self.overview()

    def _match(self, remotes: dict[str, str]) -> str | None:
        ordered = sorted(remotes.items(), key=lambda item: (item[0] != "origin", item[0] != "upstream", item[0]))
        for _, url in ordered:
            matched = match_remote(url, self._gitlab_hosts())
            if matched:
                return f"{matched[0]}:{matched[1]}"
        return None

    @staticmethod
    def _find_git_repos(roots: list[Path]) -> list[Path]:
        found: list[Path] = []
        seen: set[Path] = set()
        for root in roots:
            if not root.is_dir():
                continue
            root_depth = len(root.parts)
            for current, dirs, files in os.walk(root, followlinks=False):
                current_path = Path(current)
                if ".git" in dirs or ".git" in files:
                    resolved = current_path.resolve()
                    if resolved not in seen:
                        seen.add(resolved)
                        found.append(resolved)
                    dirs[:] = []  # pas de recherche dans un dépôt (sous-modules ignorés)
                    continue
                if len(current_path.parts) - root_depth >= MAX_SCAN_DEPTH:
                    dirs[:] = []
                    continue
                dirs[:] = [d for d in dirs if d not in _SKIPPED_DIRS and not d.startswith(".")]
        return found

    # -- Liaison ----------------------------------------------------------

    def link(self, key: str, path: str, force: bool = False) -> dict[str, Any]:
        folder = _expand(path)
        if not folder.is_dir():
            raise EasyCIError(f"Le dossier « {path} » n'existe pas.")
        root = git.repo_root(folder)
        if root is None:
            raise EasyCIError("Ce dossier n'est pas un dépôt Git (aucun dossier .git trouvé).")
        matched = self._match(git.remote_urls(root))
        if matched and matched.lower() != key.lower() and not force:
            raise LinkMismatchError(f"Ce dossier est un clone de « {matched.split(':', 1)[1]} », pas de ce dépôt.")
        if not matched and not force:
            raise LinkMismatchError("Aucun remote de ce dossier ne pointe vers ce dépôt.")
        self._set_link(key, str(root))
        return self.status(key)

    def unlink(self, key: str) -> dict[str, Any]:
        self._set_link(key, "")
        return self.overview()

    def _set_link(self, key: str, path: str) -> None:
        settings = self._settings.load()
        links = {k: v for k, v in settings["local_links"].items() if k.lower() != key.lower()}
        links[key] = path
        self._settings.update({"local_links": links})

    def clone(self, key: str, parent: str, protocol: str = "https", host: str | None = None) -> dict[str, Any]:
        provider, full_name = split_repo_key(key)
        parent_dir = _expand(parent)
        if not parent_dir.is_dir():
            raise EasyCIError(f"Le dossier « {parent} » n'existe pas.")
        name = re.sub(r"[^A-Za-z0-9._-]", "-", full_name.rsplit("/", 1)[-1]) or "depot"
        destination = parent_dir / name
        if destination.exists() and any(destination.iterdir()):
            raise EasyCIError(f"Le dossier « {_display_path(destination)} » existe déjà et n'est pas vide.")
        url = clone_urls(provider, full_name, host)["ssh" if protocol == "ssh" else "https"]
        git.clone(url, destination)
        self._set_link(key, str(destination))
        return self.status(key)

    # -- État & synchronisation ------------------------------------------

    def status(self, key: str) -> dict[str, Any]:
        path = self.project_path(key)
        if path is None:
            return {"key": key, "linked": False}
        base = {"key": key, "linked": True, "path": str(path), "display_path": _display_path(path)}
        if not path.is_dir():
            return {**base, "exists": False, "error": "Le dossier lié n'existe plus (déplacé ou supprimé)."}
        if git.repo_root(path) is None:
            return {**base, "exists": True, "error": "Ce dossier n'est plus un dépôt Git."}

        provider, full_name = split_repo_key(key)
        state = git.status(path)
        remotes = git.remote_urls(path)
        compare_ref = self._compare_ref(path, state)
        fetched = git.last_fetch_time(path)
        return {
            **base,
            "exists": True,
            "error": None,
            "branch": state["branch"],
            "detached": state["detached"],
            "upstream": state["upstream"],
            "ahead": state["ahead"],
            "behind": state["behind"],
            "dirty": state["dirty"],
            "changes": state["changes"][:MAX_CHANGES],
            "changes_count": len(state["changes"]),
            "last_commit": git.last_commit(path),
            "last_fetch_at": fetched,
            "remote_matches": (self._match(remotes) or "").lower() == key.lower(),
            "remotes": [{"name": n, "url": u} for n, u in remotes.items()],
            "compare_ref": compare_ref,
            "ci_files": self._ci_files(provider, path, state, compare_ref),
        }

    def sync(self, key: str, pull: bool = False) -> dict[str, Any]:
        """Récupère les nouveautés du distant ; si demandé, met à jour la branche en avance rapide uniquement."""
        path = self._require_path(key)
        git.fetch(path)
        result: dict[str, Any] = {"pulled": False, "skipped_reason": None}
        if pull:
            state = git.status(path)
            if not state["upstream"]:
                result["skipped_reason"] = "no_upstream"
            elif state["dirty"]:
                result["skipped_reason"] = "dirty"
            elif state["behind"] == 0:
                result["skipped_reason"] = "up_to_date"
            elif state["ahead"] > 0:
                result["skipped_reason"] = "diverged"
            else:
                git.pull_fast_forward(path)
                result["pulled"] = True
        return {**result, "status": self.status(key)}

    def ci_diff(self, key: str, file_path: str) -> dict[str, Any]:
        path = self._require_path(key)
        provider, _ = split_repo_key(key)
        if not any(_matches_pattern(file_path, pattern) for pattern in CI_PATTERNS[provider]):
            raise EasyCIError("Seuls les fichiers de configuration CI peuvent être comparés ici.")
        state = git.status(path)
        ref = self._compare_ref(path, state)
        local_file = path / file_path
        local = local_file.read_text(encoding="utf-8", errors="replace") if local_file.is_file() else None
        remote = git.show_file(path, ref, file_path) if ref else None
        return {
            "path": file_path,
            "compare_ref": ref,
            "local": local,
            "remote": remote,
            "diff": git.diff_against(path, ref, file_path) if ref else "",
        }

    # -- Édition des fichiers CI -------------------------------------------

    def read_ci_file(self, key: str, file_path: str) -> dict[str, Any]:
        """Contenu du fichier dans la copie de travail, avec une empreinte pour détecter les modifications externes."""
        path = self._require_path(key)
        provider, _ = split_repo_key(key)
        target = self._ci_target(provider, path, file_path)
        exists = target.is_file()
        content = target.read_text(encoding="utf-8", errors="replace") if exists else ""
        state = git.status(path)
        return {
            "path": file_path,
            "exists": exists,
            "content": content,
            "hash": _hash(target) if exists else None,
            "tracked": git.is_tracked(path, file_path),
            "branch": state["branch"],
            "detached": state["detached"],
        }

    def save_ci_file(self, key: str, file_path: str, content: str, expected_hash: str | None, overwrite: bool = False) -> dict[str, Any]:
        """Écrit le fichier dans le clone local. Refuse d'écraser une modification faite ailleurs entre-temps."""
        path = self._require_path(key)
        provider, _ = split_repo_key(key)
        target = self._ci_target(provider, path, file_path)
        current = _hash(target) if target.is_file() else None
        if not overwrite and current != expected_hash:
            if expected_hash is None:
                raise FileConflictError(f"« {file_path} » existe déjà dans le dossier local.")
            raise FileConflictError(f"« {file_path} » a été modifié en dehors d'Easy CI depuis son ouverture.")
        if not content.endswith("\n"):
            content += "\n"
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(f".{target.name}.easy-ci.tmp")
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, target)  # écriture atomique : jamais de fichier à moitié écrit
        return {"hash": _hash(target), "status": self.status(key)}

    def discard_ci_file(self, key: str, file_path: str) -> dict[str, Any]:
        """Annule les modifications locales non commitées d'un fichier CI (ou supprime un fichier jamais commité)."""
        path = self._require_path(key)
        provider, _ = split_repo_key(key)
        target = self._ci_target(provider, path, file_path)
        if git.is_tracked(path, file_path):
            git.restore_path(path, file_path)
        elif target.is_file():
            target.unlink()
        return self.status(key)

    def commit_ci(self, key: str, paths: list[str], message: str, new_branch: str | None = None) -> dict[str, Any]:
        path = self._require_path(key)
        provider, _ = split_repo_key(key)
        message = message.strip()
        if not message:
            raise EasyCIError("Saisissez un message de commit.")
        if not paths:
            raise EasyCIError("Sélectionnez au moins un fichier à commiter.")
        for file_path in paths:
            self._ci_target(provider, path, file_path)
        state = git.status(path)
        changed = {change["path"] for change in state["changes"]}
        unchanged = [p for p in paths if p not in changed]
        if unchanged:
            raise EasyCIError(f"Aucune modification à commiter pour : {', '.join(unchanged)}.")
        if git.identity(path) is None:
            raise EasyCIError(
                "Identité Git non configurée. Dans un terminal : git config --global user.name \"Votre nom\" puis "
                "git config --global user.email vous@exemple.fr"
            )
        if new_branch:
            new_branch = new_branch.strip()
            if not git.valid_branch_name(path, new_branch):
                raise EasyCIError(f"« {new_branch} » n'est pas un nom de branche valide.")
            if git.branch_exists(path, new_branch):
                raise EasyCIError(f"La branche « {new_branch} » existe déjà localement.")
            git.create_branch(path, new_branch)
        elif state["detached"]:
            raise EasyCIError("HEAD détachée : créez une branche pour commiter.")
        sha = git.commit_paths(path, paths, message)
        return {"sha": sha, "status": self.status(key)}

    def push(self, key: str) -> dict[str, Any]:
        """Envoie la branche courante sur le remote du dépôt. Toujours à la demande explicite de l'utilisateur."""
        path = self._require_path(key)
        state = git.status(path)
        if state["detached"] or not state["branch"]:
            raise EasyCIError("HEAD détachée : placez-vous sur une branche avant d'envoyer.")
        remote = self._push_remote(key, path, state)
        git.push_branch(path, remote, state["branch"])
        return {"remote": remote, "branch": state["branch"], "status": self.status(key)}

    def branch_suggestion(self, key: str, file_path: str | None) -> dict[str, Any]:
        path = self._require_path(key)
        state = git.status(path)
        stem = re.sub(r"[^a-z0-9]+", "-", Path(file_path or "ci").stem.lower()).strip("-") or "ci"
        base = f"ci/{stem}-{time.strftime('%Y%m%d')}"
        candidate, index = base, 2
        existing = set(git.list_local_branches(path))
        while candidate in existing:
            candidate, index = f"{base}-{index}", index + 1
        default = self._default_branch_name(path)
        return {"suggested": candidate, "current": state["branch"], "default_branch": default, "on_default_branch": state["branch"] == default}

    def _push_remote(self, key: str, path: Path, state: dict[str, Any]) -> str:
        remotes = git.remote_urls(path)
        for name, url in sorted(remotes.items(), key=lambda item: item[0] != "origin"):
            matched = match_remote(url, self._gitlab_hosts())
            if matched and f"{matched[0]}:{matched[1]}".lower() == key.lower():
                return name
        if state["upstream"]:
            return state["upstream"].split("/", 1)[0]
        if "origin" in remotes:
            return "origin"
        raise EasyCIError("Aucun remote configuré pour envoyer la branche.")

    @staticmethod
    def _default_branch_name(path: Path) -> str | None:
        head = git.run_git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd=path, check=False).stdout.strip()
        if head:
            return head.split("/", 1)[1]
        for name in ("main", "master"):
            if git.ref_exists(path, f"origin/{name}"):
                return name
        return None

    @staticmethod
    def _ci_target(provider: str, repo_path: Path, file_path: str) -> Path:
        if not any(_matches_pattern(file_path, pattern) for pattern in CI_PATTERNS[provider]):
            raise EasyCIError(f"« {file_path} » n'est pas un fichier de configuration CI {provider} modifiable ici.")
        target = (repo_path / file_path).resolve()
        if repo_path.resolve() not in target.parents:
            raise EasyCIError("Chemin de fichier invalide.")
        return target

    def open(self, key: str, target: str, editor_id: str | None = None) -> None:
        opener.open_path(self._require_path(key), target, editor_id)

    # -- Interne ----------------------------------------------------------

    def _require_path(self, key: str) -> Path:
        path = self.project_path(key)
        if path is None:
            raise EasyCIError("Aucun dossier local n'est lié à ce dépôt.")
        if not path.is_dir():
            raise EasyCIError("Le dossier lié n'existe plus (déplacé ou supprimé).")
        return path

    @staticmethod
    def _compare_ref(path: Path, state: dict[str, Any]) -> str | None:
        """Branche distante de référence : celle suivie, sinon la branche par défaut du remote."""
        candidates = [state["upstream"], "origin/HEAD", "origin/main", "origin/master"]
        return next((ref for ref in candidates if ref and git.ref_exists(path, ref)), None)

    @staticmethod
    def _ci_files(provider: str, path: Path, state: dict[str, Any], compare_ref: str | None) -> list[dict[str, Any]]:
        patterns = CI_PATTERNS[provider]
        local_files = set(git.list_files(path, patterns))
        uncommitted = {change["path"]: change["status"] for change in state["changes"]}
        remote_files = git.ls_tree(path, compare_ref, patterns) if compare_ref else set()
        unpushed = git.changed_between(path, compare_ref, "HEAD", patterns) if compare_ref else set()
        outdated = git.changed_between(path, "HEAD", compare_ref, patterns) if compare_ref else set()

        files = []
        for file_path in sorted(local_files | remote_files):
            if file_path in uncommitted:
                state_name = "uncommitted" if uncommitted[file_path] != "untracked" else "untracked"
            elif file_path in unpushed and file_path in outdated:
                state_name = "diverged"
            elif file_path in unpushed:
                state_name = "unpushed"
            elif file_path in outdated or (file_path in remote_files and file_path not in local_files):
                state_name = "outdated"
            else:
                state_name = "synced"
            files.append(
                {
                    "path": file_path,
                    "state": state_name,
                    "local": file_path in local_files,
                    "remote": file_path in remote_files,
                }
            )
        return files


def _hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _matches_pattern(file_path: str, pattern: str) -> bool:
    import fnmatch

    return fnmatch.fnmatchcase(file_path, pattern) and ".." not in Path(file_path).parts
