"""Projets locaux simulés pour le mode démo (aucun accès au disque ni à git)."""

from __future__ import annotations

import time
from copy import deepcopy
from typing import Any

from easy_ci.errors import EasyCIError

_ROOT = "~/Developer"

_UNPUSHED_DIFF = """diff --git a/.gitlab-ci.yml b/.gitlab-ci.yml
index 3f1c2aa..8b0e4d1 100644
--- a/.gitlab-ci.yml
+++ b/.gitlab-ci.yml
@@ -24,9 +24,12 @@ unit-tests:
   image: python:3.13
   needs: [build-image]
+  cache:
+    key: pip-$CI_COMMIT_REF_SLUG
+    paths: [.cache/pip]
   script:
     - pip install -r requirements-dev.txt
-    - pytest --junitxml=report.xml
+    - pytest -n auto --junitxml=report.xml
   artifacts:
     reports:
       junit: report.xml
"""

_UNCOMMITTED_DIFF = """diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 51ab0c2..e07d9f3 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -22,7 +22,10 @@ jobs:
       - uses: actions/setup-go@v5
         with:
           go-version: "1.25"
+          cache: true
       - run: go mod download
-      - run: go test -race -cover ./...
+      - run: go test -race -cover -count=1 ./...
+        env:
+          TZ: Europe/Paris
"""

_OUTDATED_DIFF = """diff --git a/.github/workflows/deploy.yml b/.github/workflows/deploy.yml
index 9c2e71b..4aa0d52 100644
--- a/.github/workflows/deploy.yml
+++ b/.github/workflows/deploy.yml
@@ -33,6 +33,7 @@ jobs:
     needs: image
     runs-on: ubuntu-latest
-    environment: staging
+    environment:
+      name: staging
+      url: https://staging.acme.dev
     steps:
"""


def _project(key: str, folder: str, **state: Any) -> dict[str, Any]:
    return {
        "key": key,
        "path": f"/Users/demo/Developer/{folder}",
        "display_path": f"{_ROOT}/{folder}",
        "source": "scan",
        "exists": True,
        "state": state,
    }


class DemoLocalProjects:
    def __init__(self) -> None:
        now = time.time()
        self._scanned_at = now
        self._roots = [{"path": "/Users/demo/Developer", "display_path": _ROOT, "exists": True}]
        self._projects: dict[str, dict[str, Any]] = {
            "github:acme/storefront": _project(
                "github:acme/storefront",
                "storefront",
                branch="main",
                upstream="origin/main",
                ahead=0,
                behind=2,
                changes=[],
                ci={".github/workflows/ci.yml": "synced", ".github/workflows/deploy.yml": "outdated", ".github/workflows/codeql.yml": "synced"},
                commit=("a1f09c3", "feat: nouveau tunnel de commande", "Utilisateur démo", 3),
            ),
            "github:acme/payments-api": _project(
                "github:acme/payments-api",
                "payments-api",
                branch="fix/ledger-concurrency",
                upstream="origin/fix/ledger-concurrency",
                ahead=0,
                behind=0,
                changes=[{"path": ".github/workflows/ci.yml", "status": "modified"}, {"path": "internal/ledger/ledger.go", "status": "modified"}],
                ci={".github/workflows/ci.yml": "uncommitted", ".github/workflows/release.yml": "synced"},
                commit=("7d2e4b1", "fix(ledger): verrou sur les transferts concurrents", "Utilisateur démo", 1),
            ),
            "gitlab:platform/backend/billing-service": _project(
                "gitlab:platform/backend/billing-service",
                "billing-service",
                branch="ci/cache-pip",
                upstream="origin/ci/cache-pip",
                ahead=1,
                behind=0,
                changes=[],
                ci={".gitlab-ci.yml": "unpushed"},
                commit=("c93b0fa", "ci: cache pip et tests parallèles", "Utilisateur démo", 0.5),
            ),
        }
        self._unmatched = [{"path": "/Users/demo/Developer/notes", "display_path": f"{_ROOT}/notes", "remotes": []}]
        self._fetched: dict[str, float] = {key: now - 3600 for key in self._projects}

    # -- Vue d'ensemble ---------------------------------------------------

    def overview(self) -> dict[str, Any]:
        return {
            "git_version": "2.50.1 (démo)",
            "roots": deepcopy(self._roots),
            "projects": [
                {k: v for k, v in project.items() if k != "state"} | {"candidates": [project["path"]]}
                for project in sorted(self._projects.values(), key=lambda p: p["key"])
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
        raise EasyCIError("En mode démo, saisissez un chemin : les dossiers sont fictifs.")

    def add_root(self, path: str) -> dict[str, Any]:
        display = path if path.startswith("~") else path
        if not any(root["display_path"] == display for root in self._roots):
            self._roots.append({"path": path, "display_path": display, "exists": True})
        return self.scan()

    def remove_root(self, path: str) -> dict[str, Any]:
        self._roots = [root for root in self._roots if root["path"] != path]
        return self.overview()

    def scan(self) -> dict[str, Any]:
        self._scanned_at = time.time()
        return self.overview()

    # -- Liaison ----------------------------------------------------------

    def link(self, key: str, path: str, force: bool = False) -> dict[str, Any]:
        folder = path.rstrip("/").rsplit("/", 1)[-1] or "projet"
        project = _project(
            key,
            folder,
            branch="main",
            upstream="origin/main",
            ahead=0,
            behind=0,
            changes=[],
            ci={},
            commit=("0b1c2d3", "chore: initialisation", "Utilisateur démo", 24),
        )
        project["path"], project["display_path"], project["source"] = path, path, "manual"
        self._projects[key] = project
        self._fetched[key] = time.time()
        return self.status(key)

    def unlink(self, key: str) -> dict[str, Any]:
        self._projects.pop(key, None)
        return self.overview()

    def clone(self, key: str, parent: str, protocol: str = "https", host: str | None = None) -> dict[str, Any]:
        name = key.rsplit("/", 1)[-1]
        status = self.link(key, f"{parent.rstrip('/')}/{name}")
        self._projects[key]["source"] = "manual"
        return status

    # -- État & synchronisation ------------------------------------------

    def status(self, key: str) -> dict[str, Any]:
        project = self._projects.get(key)
        if project is None:
            return {"key": key, "linked": False}
        state = project["state"]
        sha, message, author, hours = state["commit"]
        return {
            "key": key,
            "linked": True,
            "path": project["path"],
            "display_path": project["display_path"],
            "exists": True,
            "error": None,
            "branch": state["branch"],
            "detached": False,
            "upstream": state["upstream"],
            "ahead": state["ahead"],
            "behind": state["behind"],
            "dirty": bool(state["changes"]),
            "changes": deepcopy(state["changes"]),
            "changes_count": len(state["changes"]),
            "last_commit": {"sha": sha * 5, "message": message, "author": author, "date": _iso(time.time() - hours * 3600)},
            "last_fetch_at": self._fetched.get(key),
            "remote_matches": True,
            "remotes": [{"name": "origin", "url": f"git@example.com:{key.split(':', 1)[1]}.git"}],
            "compare_ref": state["upstream"],
            "ci_files": [{"path": p, "state": s, "local": True, "remote": True} for p, s in sorted(state["ci"].items())],
        }

    def sync(self, key: str, pull: bool = False) -> dict[str, Any]:
        project = self._projects.get(key)
        if project is None:
            raise EasyCIError("Aucun dossier local n'est lié à ce dépôt.")
        self._fetched[key] = time.time()
        state = project["state"]
        result: dict[str, Any] = {"pulled": False, "skipped_reason": None}
        if pull:
            if state["changes"]:
                result["skipped_reason"] = "dirty"
            elif state["behind"] == 0:
                result["skipped_reason"] = "up_to_date"
            elif state["ahead"]:
                result["skipped_reason"] = "diverged"
            else:
                state["behind"] = 0
                state["ci"] = {path: "synced" if value == "outdated" else value for path, value in state["ci"].items()}
                result["pulled"] = True
        return {**result, "status": self.status(key)}

    def ci_diff(self, key: str, file_path: str) -> dict[str, Any]:
        project = self._projects.get(key)
        if project is None:
            raise EasyCIError("Aucun dossier local n'est lié à ce dépôt.")
        file_state = project["state"]["ci"].get(file_path, "synced")
        diff = {"unpushed": _UNPUSHED_DIFF, "uncommitted": _UNCOMMITTED_DIFF, "outdated": _OUTDATED_DIFF}.get(file_state, "")
        return {"path": file_path, "compare_ref": project["state"]["upstream"], "local": None, "remote": None, "diff": diff}

    def open(self, key: str, target: str, editor_id: str | None = None) -> None:
        raise EasyCIError("En mode démo, les dossiers affichés sont fictifs : rien à ouvrir.")

    def project_path(self, key: str) -> None:
        return None


def _iso(timestamp: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
