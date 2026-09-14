"""Accès en lecture aux fichiers d'un projet, sur disque ou en mémoire (mode démo, tests)."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

MAX_READ_BYTES = 512_000
IGNORED_DIRS = {
    "node_modules", ".git", ".venv", "venv", "env", "__pycache__", "dist", "build", "target", "vendor", ".next", ".nuxt",
    ".idea", ".vscode", ".gradle", "Pods", "coverage", ".cache", ".turbo", ".pnpm-store",
}


class ProjectFiles(Protocol):
    def exists(self, path: str) -> bool: ...
    def read(self, path: str) -> str | None: ...
    def listdir(self, path: str = ".") -> list[str]: ...
    def is_dir(self, path: str) -> bool: ...


def _join(base: str, name: str) -> str:
    return name if base in ("", ".") else f"{base.rstrip('/')}/{name}"


class DiskFiles:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _path(self, path: str) -> Path | None:
        target = (self.root / path).resolve()
        return target if target == self.root or self.root in target.parents else None

    def exists(self, path: str) -> bool:
        target = self._path(path)
        return bool(target and target.exists())

    def is_dir(self, path: str) -> bool:
        target = self._path(path)
        return bool(target and target.is_dir())

    def read(self, path: str) -> str | None:
        target = self._path(path)
        if not target or not target.is_file() or target.stat().st_size > MAX_READ_BYTES:
            return None
        try:
            return target.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None

    def listdir(self, path: str = ".") -> list[str]:
        target = self._path(path)
        if not target or not target.is_dir():
            return []
        try:
            return sorted(entry.name for entry in target.iterdir() if entry.name not in IGNORED_DIRS)
        except OSError:
            return []


class MemoryFiles:
    """Arborescence virtuelle : {"frontend/package.json": "{…}"}."""

    def __init__(self, files: dict[str, str]) -> None:
        self.files = {path.strip("/"): content for path, content in files.items()}

    def exists(self, path: str) -> bool:
        return path in self.files or self.is_dir(path)

    def is_dir(self, path: str) -> bool:
        prefix = "" if path in ("", ".") else path.rstrip("/") + "/"
        return any(name.startswith(prefix) for name in self.files) and path not in self.files

    def read(self, path: str) -> str | None:
        return self.files.get(path)

    def listdir(self, path: str = ".") -> list[str]:
        prefix = "" if path in ("", ".") else path.rstrip("/") + "/"
        names = {name[len(prefix) :].split("/", 1)[0] for name in self.files if name.startswith(prefix)}
        return sorted(name for name in names if name and name not in IGNORED_DIRS)


__all__ = ["DiskFiles", "MemoryFiles", "ProjectFiles", "_join"]
