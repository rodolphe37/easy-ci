"""Vérification d'une installation (utilisée par la CI sur les versions empaquetées).

N'ouvre aucune fenêtre : contrôle que l'interface compilée, les icônes et le moteur de rendu
pywebview du système sont bien embarqués. Code de sortie 0 si tout est présent.
"""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from typing import Any

from easy_ci import __version__

GUI_MODULES = {"darwin": "webview.platforms.cocoa", "win32": "webview.platforms.edgechromium"}


def run_self_check() -> int:
    package = Path(__file__).parent
    report: dict[str, Any] = {
        "version": __version__,
        "frozen": bool(getattr(sys, "frozen", False)),
        "web": (package / "web" / "index.html").is_file(),
        "resources": all((package / "resources" / name).is_file() for name in ("icon.png", "icon.icns", "icon.ico")),
    }
    gui = GUI_MODULES.get(sys.platform, "webview.platforms.qt")
    for label, module in (("webview", "webview"), ("gui", gui), ("keyring", "keyring"), ("yaml", "yaml"), ("httpx", "httpx")):
        try:
            importlib.import_module(module)
            report[label] = True
        except Exception as exc:  # le rapport doit lister tous les problèmes, pas seulement le premier
            report[label] = f"{type(exc).__name__}: {exc}"
    ok = all(value is True for key, value in report.items() if key not in ("version", "frozen"))
    report["ok"] = ok
    if sys.stdout is not None:  # application fenêtrée Windows : pas de console
        print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if ok else 1
