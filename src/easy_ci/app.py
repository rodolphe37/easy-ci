"""Fenêtre desktop : charge l'interface web et expose l'API Python via pywebview."""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any

import webview
from platformdirs import user_data_dir

from easy_ci import __version__
from easy_ci.api import Api
from easy_ci.storage import APP_NAME

log = logging.getLogger(__name__)

WEB_DIR = Path(__file__).parent / "web"
RESOURCES_DIR = Path(__file__).parent / "resources"
DEV_URL = "http://localhost:5173"


class JsBridge:
    """Seule la méthode `call` est visible côté JavaScript (window.pywebview.api.call)."""

    def __init__(self, api: Api) -> None:
        self._api = api

    def call(self, method: str, params: dict[str, Any] | None = None, language: str | None = None) -> dict[str, Any]:
        return self._api.call(method, params, language)


def _apply_macos_identity() -> None:
    """Icône du Dock et nom de l'app quand Easy CI est lancé depuis Python (hors bundle .app).

    Une fois empaquetée, l'application tire ces informations de son Info.plist et de icon.icns.
    """
    try:
        from AppKit import NSApplication, NSImage  # fourni par pyobjc, dépendance de pywebview sur macOS
        from Foundation import NSBundle
    except ImportError:
        return
    try:
        info = NSBundle.mainBundle().infoDictionary()
        if info is not None:
            info["CFBundleName"] = APP_NAME
        image = NSImage.alloc().initWithContentsOfFile_(str(RESOURCES_DIR / "icon.icns"))
        if image is not None:
            NSApplication.sharedApplication().setApplicationIconImage_(image)
    except Exception:  # purement cosmétique : ne doit jamais empêcher le lancement
        log.debug("Impossible d'appliquer l'icône macOS", exc_info=True)


def interface_url(index: Path) -> str:
    """Adresse de l'interface, propre à chaque version installée.

    pywebview sert l'interface sur une adresse fixe (http://127.0.0.1:42001) pour conserver le
    localStorage, et ses en-têtes « no-cache » sont perdus (bottle.static_file les remplace) :
    après une mise à jour, le moteur web pouvait resservir l'ancien index.html depuis son cache,
    donc l'ancienne interface. La version et la date du fichier changent l'adresse à chaque
    installation ; les autres fichiers ont déjà un nom unique par compilation (Vite).
    """
    try:
        stamp = int(index.stat().st_mtime)
    except OSError:
        stamp = 0
    return f"{index}?v={__version__}-{stamp}"


def _extend_path_for_bundle() -> None:
    """Une app lancée depuis le Finder hérite d'un PATH minimal : on ajoute les emplacements usuels de git, gh et des éditeurs."""
    if sys.platform != "darwin" or not getattr(sys, "frozen", False):
        return
    current = os.environ.get("PATH", "").split(os.pathsep)
    extra = [folder for folder in ("/opt/homebrew/bin", "/usr/local/bin") if folder not in current and Path(folder).is_dir()]
    os.environ["PATH"] = os.pathsep.join([*extra, *current])


def run(dev: bool = False, debug: bool = False) -> int:
    logging.basicConfig(level=logging.DEBUG if debug else logging.INFO)
    _extend_path_for_bundle()
    index = WEB_DIR / "index.html"
    if not dev and not index.exists():
        print("Interface non compilée. Lancez : cd frontend && npm install && npm run build")
        return 1

    if sys.platform == "darwin":
        _apply_macos_identity()

    api = Api()
    window = webview.create_window(
        APP_NAME,
        DEV_URL if dev else interface_url(index),
        js_api=JsBridge(api),
        width=1380,
        height=880,
        min_size=(1040, 680),
        background_color="#0b0b0f",
        text_select=True,
    )

    def pick_folder(title: str) -> str | None:
        selection = window.create_file_dialog(webview.FileDialog.FOLDER, directory=str(Path.home()))
        return selection[0] if selection else None

    api.set_folder_picker(pick_folder)
    webview.start(
        debug=debug,
        private_mode=False,  # conserve le localStorage (thème, préférences d'affichage)
        storage_path=user_data_dir(APP_NAME, appauthor=False),
        # Icône de fenêtre sous Linux (GTK/Qt) ; Windows et macOS utilisent l'icône du paquet.
        icon=str(RESOURCES_DIR / "icon.png"),
    )
    return 0
