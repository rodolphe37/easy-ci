"""Ouverture d'un dossier dans le gestionnaire de fichiers, un éditeur ou un terminal."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from easy_ci.errors import EasyCIError
from easy_ci.i18n import tr

# (identifiant, nom affiché, application macOS, commande en ligne)
_EDITORS: list[tuple[str, str, str, str]] = [
    ("vscode", "Visual Studio Code", "Visual Studio Code", "code"),
    ("cursor", "Cursor", "Cursor", "cursor"),
    ("zed", "Zed", "Zed", "zed"),
    ("sublime", "Sublime Text", "Sublime Text", "subl"),
    ("webstorm", "WebStorm", "WebStorm", "webstorm"),
    ("pycharm", "PyCharm", "PyCharm", "pycharm"),
    ("intellij", "IntelliJ IDEA", "IntelliJ IDEA", "idea"),
    ("fleet", "Fleet", "Fleet", "fleet"),
]


def _mac_app(name: str) -> Path | None:
    for base in (Path("/Applications"), Path.home() / "Applications"):
        candidate = base / f"{name}.app"
        if candidate.exists():
            return candidate
    return None


def available_editors() -> list[dict[str, str]]:
    editors = []
    for editor_id, label, mac_name, command in _EDITORS:
        if (sys.platform == "darwin" and _mac_app(mac_name)) or shutil.which(command):
            editors.append({"id": editor_id, "label": label})
    return editors


def file_manager_label() -> str:
    if sys.platform == "darwin":
        return "Finder"
    if sys.platform.startswith("win"):
        return tr("l'Explorateur")
    return tr("le gestionnaire de fichiers")


def open_path(path: Path, target: str, editor_id: str | None = None) -> None:
    if not path.is_dir():
        raise EasyCIError(tr("Le dossier « {path} » n'existe plus.", path=path))
    try:
        if target == "folder":
            _open_folder(path)
        elif target == "terminal":
            _open_terminal(path)
        elif target == "editor":
            _open_editor(path, editor_id)
        else:
            raise EasyCIError(tr("Action d'ouverture inconnue : {target}", target=target))
    except OSError as exc:
        raise EasyCIError(f"Ouverture impossible : {exc}") from exc


def _spawn(args: list[str], **kwargs: Any) -> None:
    subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs)  # noqa: S603


def _open_folder(path: Path) -> None:
    if sys.platform == "darwin":
        _spawn(["open", str(path)])
    elif sys.platform.startswith("win"):
        os.startfile(str(path))  # type: ignore[attr-defined]  # noqa: S606
    else:
        _spawn(["xdg-open", str(path)])


def _open_terminal(path: Path) -> None:
    if sys.platform == "darwin":
        _spawn(["open", "-a", "Terminal", str(path)])
    elif sys.platform.startswith("win"):
        _spawn(["cmd", "/c", "start", "cmd"], cwd=str(path))
    else:
        for terminal in ("x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal"):
            if shutil.which(terminal):
                _spawn([terminal], cwd=str(path))
                return
        raise EasyCIError(tr("Aucun terminal trouvé sur ce système."))


def _open_editor(path: Path, editor_id: str | None) -> None:
    editors = {e[0]: e for e in _EDITORS}
    choices = [editors[editor_id]] if editor_id in editors else _EDITORS
    for _, _label, mac_name, command in choices:
        if sys.platform == "darwin" and _mac_app(mac_name):
            _spawn(["open", "-a", mac_name, str(path)])
            return
        if shutil.which(command):
            _spawn([command, str(path)])
            return
    raise EasyCIError(tr("Aucun éditeur de code reconnu n'est installé (VS Code, Cursor, Zed, Sublime Text, JetBrains…)."))
