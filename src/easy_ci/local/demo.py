"""Projets locaux simulés pour le mode démo (aucun accès au disque ni à git).

Chaque fichier CI a trois versions : copie de travail, dernier commit local et branche distante.
Éditer, commiter et envoyer font évoluer ces versions comme le ferait git.
"""

from __future__ import annotations

import difflib
import hashlib
import re
import time
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from easy_ci.errors import EasyCIError, FileConflictError
from easy_ci.generation.demo_projects import demo_project_tree
from easy_ci.generation.files import MemoryFiles
from easy_ci.i18n import N_, tr
from easy_ci.local.service import CI_PATTERNS, _matches_pattern
from easy_ci.providers import split_repo_key

_ROOT = "~/Developer"


@dataclass
class DemoFile:
    content: str | None  # copie de travail (None : absent)
    committed: str | None  # dernier commit local
    remote: str | None  # branche distante suivie
    outdated: bool = False  # la version distante est plus récente que la locale


@dataclass
class DemoProject:
    key: str
    folder: str
    branch: str
    upstream: str | None
    behind: int
    ahead: int = 0
    other_changes: list[dict[str, str]] = field(default_factory=list)
    files: dict[str, DemoFile] = field(default_factory=dict)
    commit: tuple[str, str, float] = ("a1f09c3", N_("chore: mise à jour"), 3)
    source: str = "scan"
    fetched_at: float = 0.0

    @property
    def path(self) -> str:
        return f"/Users/demo/Developer/{self.folder}" if self.source == "scan" else self.folder

    @property
    def display_path(self) -> str:
        return f"{_ROOT}/{self.folder}" if self.source == "scan" else self.folder


def _hash(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


def _files_from(demo: Any, repo: str) -> dict[str, DemoFile]:
    files = {}
    for workflow in getattr(demo, "_workflows", {}).get(repo, []):
        files[workflow.path] = DemoFile(workflow.content, workflow.content, workflow.content)
    return files


class DemoLocalProjects:
    def __init__(self, demo: Any = None) -> None:
        now = time.time()
        self._demo = demo
        self._scanned_at = now
        self._roots = [{"path": "/Users/demo/Developer", "display_path": _ROOT, "exists": True}]
        self._unmatched = [{"path": "/Users/demo/Developer/notes", "display_path": f"{_ROOT}/notes", "remotes": []}]
        self._projects: dict[str, DemoProject] = {}

        storefront = self._add("github:acme/storefront", "storefront", "main", "origin/main", behind=2, commit=("a1f09c3", tr("feat: nouveau tunnel de commande"), 3))
        deploy = storefront.files.get(".github/workflows/deploy.yml")
        if deploy and deploy.remote:
            deploy.remote = deploy.remote.replace("    environment: staging\n", "    environment:\n      name: staging\n      url: https://staging.acme.dev\n")
            deploy.outdated = True

        payments = self._add(
            "github:acme/payments-api",
            "payments-api",
            "fix/ledger-concurrency",
            "origin/fix/ledger-concurrency",
            behind=0,
            commit=("7d2e4b1", tr("fix(ledger): verrou sur les transferts concurrents"), 1),
        )
        payments.other_changes = [{"path": "internal/ledger/ledger.go", "status": "modified"}]
        ci = payments.files.get(".github/workflows/ci.yml")
        if ci and ci.content:
            ci.content = ci.content.replace(
                "      - run: go mod download\n      - run: go test -race -cover ./...",
                "      - run: go mod download\n      - run: go test -race -cover -count=1 ./...\n        env:\n          TZ: Europe/Paris",
            )

        billing = self._add("gitlab:platform/backend/billing-service", "billing-service", "ci/cache-pip", "origin/ci/cache-pip", behind=0, commit=("c93b0fa", tr("ci: cache pip et tests parallèles"), 0.5))
        gitlab_ci = billing.files.get(".gitlab-ci.yml")
        if gitlab_ci and gitlab_ci.content:
            changed = gitlab_ci.content.replace(
                "  needs: [build-image]\n  script:\n    - pip install -r requirements-dev.txt\n    - pytest --junitxml=report.xml",
                "  needs: [build-image]\n  cache:\n    key: pip-$CI_COMMIT_REF_SLUG\n    paths: [.cache/pip]\n  script:\n    - pip install -r requirements-dev.txt\n    - pytest -n auto --junitxml=report.xml",
            )
            gitlab_ci.content = gitlab_ci.committed = changed
            billing.ahead = 1

        # Projet sans CI : point de départ idéal pour l'assistant de génération.
        self._add("github:acme/handbook", "handbook", "main", "origin/main", behind=0, commit=("5e8d21a", tr("docs: guide d'accueil des nouveaux arrivants"), 72))

    def _add(self, key: str, folder: str, branch: str, upstream: str | None, behind: int, commit: tuple[str, str, float]) -> DemoProject:
        _, repo = split_repo_key(key)
        project = DemoProject(key, folder, branch, upstream, behind, commit=commit, files=_files_from(self._demo, repo), fetched_at=time.time() - 3600)
        self._projects[key] = project
        return project

    # -- Vue d'ensemble ---------------------------------------------------

    def overview(self) -> dict[str, Any]:
        return {
            "git_version": tr("2.50.1 (démo)"),
            "roots": deepcopy(self._roots),
            "projects": [
                {"key": p.key, "path": p.path, "display_path": p.display_path, "source": p.source, "exists": True, "candidates": [p.path]}
                for p in sorted(self._projects.values(), key=lambda p: p.key)
            ],
            "unmatched": deepcopy(self._unmatched),
            "scanned_at": self._scanned_at,
            "scanning": False,
            "picker_available": False,
            "editors": [{"id": "vscode", "label": "Visual Studio Code"}],
            "file_manager": "Finder",
            "demo": True,
        }

    def pick_folder(self, title: str = "") -> str | None:
        raise EasyCIError(tr("En mode démo, saisissez un chemin : les dossiers sont fictifs."))

    def add_root(self, path: str) -> dict[str, Any]:
        if not any(root["display_path"] == path for root in self._roots):
            self._roots.append({"path": path, "display_path": path, "exists": True})
        return self.scan()

    def remove_root(self, path: str) -> dict[str, Any]:
        self._roots = [root for root in self._roots if root["path"] != path]
        return self.overview()

    def scan(self) -> dict[str, Any]:
        self._scanned_at = time.time()
        return self.overview()

    # -- Liaison ----------------------------------------------------------

    def link(self, key: str, path: str, force: bool = False) -> dict[str, Any]:
        project = self._add(key, path, "main", "origin/main", behind=0, commit=("0b1c2d3", "chore: initialisation", 24))
        project.source = "manual"
        project.fetched_at = time.time()
        return self.status(key)

    def unlink(self, key: str) -> dict[str, Any]:
        self._projects.pop(key, None)
        return self.overview()

    def clone(self, key: str, parent: str, protocol: str = "https", host: str | None = None) -> dict[str, Any]:
        return self.link(key, f"{parent.rstrip('/')}/{key.rsplit('/', 1)[-1]}")

    # -- État & synchronisation ------------------------------------------

    def _project(self, key: str) -> DemoProject:
        project = self._projects.get(key)
        if project is None:
            raise EasyCIError(tr("Aucun dossier local n'est lié à ce dépôt."))
        return project

    @staticmethod
    def _file_state(file: DemoFile) -> str:
        if file.content != file.committed:
            return "untracked" if file.committed is None else "uncommitted"
        if file.outdated:
            return "outdated"
        if file.committed != file.remote:
            return "unpushed"
        return "synced"

    def status(self, key: str) -> dict[str, Any]:
        project = self._projects.get(key)
        if project is None:
            return {"key": key, "linked": False}
        ci_changes = [
            {"path": path, "status": "untracked" if file.committed is None else "modified"}
            for path, file in sorted(project.files.items())
            if file.content != file.committed
        ]
        changes = ci_changes + deepcopy(project.other_changes)
        sha, message, hours = project.commit
        message = tr(message)
        return {
            "key": key,
            "linked": True,
            "path": project.path,
            "display_path": project.display_path,
            "exists": True,
            "error": None,
            "branch": project.branch,
            "detached": False,
            "upstream": project.upstream,
            "ahead": project.ahead,
            "behind": project.behind,
            "dirty": bool(changes),
            "changes": changes,
            "changes_count": len(changes),
            "last_commit": {"sha": (sha * 6)[:40], "message": message, "author": tr("Utilisateur démo"), "date": _iso(time.time() - hours * 3600)},
            "last_fetch_at": project.fetched_at,
            "remote_matches": True,
            "remotes": [{"name": "origin", "url": f"git@example.com:{split_repo_key(key)[1]}.git"}],
            "compare_ref": project.upstream or "origin/main",
            "ci_files": [
                {"path": path, "state": self._file_state(file), "local": file.content is not None, "remote": file.remote is not None}
                for path, file in sorted(project.files.items())
                if file.content is not None or file.remote is not None
            ],
        }

    def sync(self, key: str, pull: bool = False) -> dict[str, Any]:
        project = self._project(key)
        project.fetched_at = time.time()
        result: dict[str, Any] = {"pulled": False, "skipped_reason": None}
        if pull:
            if not project.upstream:
                result["skipped_reason"] = "no_upstream"
            elif self.status(key)["dirty"]:
                result["skipped_reason"] = "dirty"
            elif project.behind == 0:
                result["skipped_reason"] = "up_to_date"
            elif project.ahead:
                result["skipped_reason"] = "diverged"
            else:
                project.behind = 0
                for file in project.files.values():
                    if file.outdated:
                        file.content = file.committed = file.remote
                        file.outdated = False
                result["pulled"] = True
        return {**result, "status": self.status(key)}

    def ci_diff(self, key: str, file_path: str) -> dict[str, Any]:
        project = self._project(key)
        file = project.files.get(file_path)
        if file is None:
            raise EasyCIError("Fichier introuvable.")
        remote, local = file.remote or "", file.content or ""
        diff = "".join(difflib.unified_diff(remote.splitlines(keepends=True), local.splitlines(keepends=True), f"a/{file_path}", f"b/{file_path}"))
        return {"path": file_path, "compare_ref": project.upstream, "local": file.content, "remote": file.remote, "diff": diff}

    def open(self, key: str, target: str, editor_id: str | None = None) -> None:
        raise EasyCIError(tr("En mode démo, les dossiers affichés sont fictifs : rien à ouvrir."))

    def project_path(self, key: str) -> None:
        return None

    def project_files(self, key: str) -> MemoryFiles:
        project = self._project(key)
        tree = dict(demo_project_tree(key))
        for path, file in project.files.items():
            if file.content is not None:
                tree[path] = file.content
        return MemoryFiles(tree)

    # -- Édition ----------------------------------------------------------

    def _check_path(self, key: str, file_path: str) -> None:
        provider, _ = split_repo_key(key)
        if not any(_matches_pattern(file_path, pattern) for pattern in CI_PATTERNS[provider]):
            raise EasyCIError(tr("« {file_path} » n'est pas un fichier de configuration CI {provider} modifiable ici.", file_path=file_path, provider=provider))

    def read_ci_file(self, key: str, file_path: str) -> dict[str, Any]:
        project = self._project(key)
        self._check_path(key, file_path)
        file = project.files.get(file_path)
        content = file.content if file and file.content is not None else ""
        return {
            "path": file_path,
            "exists": bool(file and file.content is not None),
            "content": content,
            "hash": _hash(content) if file and file.content is not None else None,
            "tracked": bool(file and file.committed is not None),
            "branch": project.branch,
            "detached": False,
        }

    def save_ci_file(self, key: str, file_path: str, content: str, expected_hash: str | None, overwrite: bool = False) -> dict[str, Any]:
        project = self._project(key)
        self._check_path(key, file_path)
        file = project.files.get(file_path)
        current = _hash(file.content) if file and file.content is not None else None
        if not overwrite and current != expected_hash:
            raise FileConflictError(tr("« {file_path} » existe déjà dans le dossier local.", file_path=file_path) if expected_hash is None else tr("« {file_path} » a été modifié en dehors d'Easy CI.", file_path=file_path))
        if not content.endswith("\n"):
            content += "\n"
        if file is None:
            file = project.files[file_path] = DemoFile(None, None, None)
        file.content = content
        return {"hash": _hash(content), "status": self.status(key)}

    def discard_ci_file(self, key: str, file_path: str) -> dict[str, Any]:
        project = self._project(key)
        file = project.files.get(file_path)
        if file is not None:
            if file.committed is None and file.remote is None:
                project.files.pop(file_path)
            else:
                file.content = file.committed
        return self.status(key)

    def branch_suggestion(self, key: str, file_path: str | None) -> dict[str, Any]:
        project = self._project(key)
        stem = re.sub(r"[^a-z0-9]+", "-", (file_path or "ci").rsplit("/", 1)[-1].rsplit(".", 1)[0].lower()).strip("-") or "ci"
        return {"suggested": f"ci/{stem}-{time.strftime('%Y%m%d')}", "current": project.branch, "default_branch": "main", "on_default_branch": project.branch == "main"}

    def commit_ci(self, key: str, paths: list[str], message: str, new_branch: str | None = None) -> dict[str, Any]:
        project = self._project(key)
        if not message.strip():
            raise EasyCIError(tr("Saisissez un message de commit."))
        if not paths:
            raise EasyCIError(tr("Sélectionnez au moins un fichier à commiter."))
        for path in paths:
            file = project.files.get(path)
            if file is None or file.content == file.committed:
                raise EasyCIError(tr("Aucune modification à commiter pour : {path}.", path=path))
        if new_branch:
            new_branch = new_branch.strip()
            if not re.fullmatch(r"[A-Za-z0-9._/-]+", new_branch) or new_branch.endswith("/") or ".." in new_branch:
                raise EasyCIError(tr("« {new_branch} » n'est pas un nom de branche valide.", new_branch=new_branch))
            project.branch, project.upstream, project.ahead, project.behind = new_branch, None, 0, 0
        for path in paths:
            project.files[path].committed = project.files[path].content
            project.files[path].outdated = False
        project.ahead += 1
        sha = hashlib.sha1(f"{key}{time.time()}".encode()).hexdigest()
        project.commit = (sha[:7], message.strip().splitlines()[0], 0)
        return {"sha": sha, "status": self.status(key)}

    def push(self, key: str) -> dict[str, Any]:
        project = self._project(key)
        project.upstream = f"origin/{project.branch}"
        project.ahead = 0
        for file in project.files.values():
            file.remote = file.committed
        return {"remote": "origin", "branch": project.branch, "status": self.status(key)}


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, UTC).isoformat()
