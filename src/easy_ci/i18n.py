"""Traduction des messages du moteur (erreurs, validation, génération, instructions).

Le français est la langue source : le texte français sert de clé (principe de gettext) et
`locales/<langue>.json` fournit sa traduction. Un texte absent du catalogue reste en français ;
`tests/test_i18n.py` vérifie que chaque appel à `tr()` est traduit.

La langue suit celle de l'interface : chaque appel de l'interface la transmet (`Api.call`).
"""

from __future__ import annotations

import json
import locale
import os
import sys
from functools import cache
from pathlib import Path
from typing import Any

SOURCE_LANGUAGE = "fr"
LANGUAGES = ("fr", "en")
_LOCALES_DIR = Path(__file__).parent / "locales"

_current = SOURCE_LANGUAGE


@cache
def catalog(language: str) -> dict[str, str]:
    path = _LOCALES_DIR / f"{language}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def normalize(language: str | None) -> str | None:
    if not language:
        return None
    code = language.replace("_", "-").split("-", 1)[0].lower()
    return code if code in LANGUAGES else None


def set_language(language: str | None) -> None:
    global _current
    _current = normalize(language) or _current


def current_language() -> str:
    return _current


def tr(text: str, /, **values: Any) -> str:
    """Traduit un texte français dans la langue courante, puis remplace les {variables}."""
    template = text if _current == SOURCE_LANGUAGE else catalog(_current).get(text, text)
    return template.format(**values) if values else template


def plural(count: int, one: str, other: str, /, **values: Any) -> str:
    """Accord selon la langue : en français 0 et 1 sont au singulier, en anglais seul 1 l'est."""
    singular = count <= 1 if _current == "fr" else count == 1
    return tr(one if singular else other, count=count, **values)


def system_language() -> str:
    """Langue préférée du système, ramenée aux langues disponibles (anglais par défaut)."""
    candidates: list[str | None] = []
    if sys.platform == "darwin":
        try:
            from Foundation import NSLocale  # pyobjc, présent avec pywebview sur macOS

            candidates += [str(code) for code in NSLocale.preferredLanguages()[:3]]
        except Exception:
            pass
    for variable in ("LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"):
        candidates.append(os.environ.get(variable))
    try:
        candidates.append(locale.getlocale()[0])
    except ValueError:
        pass
    if sys.platform == "win32":
        try:
            import ctypes

            candidates.append(locale.windows_locale.get(ctypes.windll.kernel32.GetUserDefaultUILanguage()))
        except Exception:
            pass
    for candidate in candidates:
        if candidate and candidate not in ("C", "POSIX") and normalize(candidate):
            return normalize(candidate)  # type: ignore[return-value]
    return "en"


def N_(text: str, /) -> str:  # noqa: N802 — nom conventionnel de gettext
    """Marque un texte à traduire plus tard (constantes de module) : `tr(CONSTANTE)` à l'usage."""
    return text
