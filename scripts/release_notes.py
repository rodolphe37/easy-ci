#!/usr/bin/env python3
"""Notes bilingues d'une GitHub Release, tirées de CHANGELOG.fr.md et CHANGELOG.md.

    python scripts/release_notes.py 0.3.0 --repository rodolphe37/easy-ci > notes.md

Chaque langue est encadrée par <!-- lang:fr --> … <!-- /lang --> : GitHub affiche les deux blocs,
le site et la fenêtre de mise à jour de l'application n'affichent que celui de la langue choisie.
Une version finale doit avoir sa section dans les deux journaux ; une préversion (1.2.0-beta.1)
sans section utilise « Unreleased ».
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TEXTS = {
    "fr": {
        "changelog": "CHANGELOG.fr.md",
        "whats_new": "Nouveautés",
        "downloads": "Téléchargements",
        "system": "Système",
        "file": "Fichier",
        "macos_arm": "macOS Apple Silicon (M1 et suivants)",
        "install": "Installation en une commande",
        "macos_comment": "macOS (ou : brew tap {tap} && brew install --cask easy-ci)",
        "after": "Déjà installé ? Easy CI signale la nouvelle version et affiche la commande de mise à jour. "
        "Applications non signées : avec un téléchargement manuel, clic droit › **Ouvrir** au premier lancement sur macOS, "
        "**Informations complémentaires › Exécuter quand même** sur Windows. Git est nécessaire pour les projets locaux.",
        "compare": "**Toutes les modifications** : {url}",
    },
    "en": {
        "changelog": "CHANGELOG.md",
        "whats_new": "What's new",
        "downloads": "Downloads",
        "system": "System",
        "file": "File",
        "macos_arm": "macOS Apple Silicon (M1 and later)",
        "install": "One-command install",
        "macos_comment": "macOS (or: brew tap {tap} && brew install --cask easy-ci)",
        "after": "Already installed? Easy CI detects the new version and shows the upgrade command. "
        "Unsigned apps: after a manual download, right-click › **Open** on first launch on macOS, "
        "**More info › Run anyway** on Windows. Git is required for local projects.",
        "compare": "**Full changelog**: {url}",
    },
}


def changelog_section(changelog: str, version: str) -> str | None:
    """Contenu de « ## [version] » (sans le titre), ou None si la version n'y figure pas."""
    match = re.search(rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|^\[[^\]]+\]:|\Z)", changelog, re.M | re.S)
    return match.group(1).strip() if match else None


def compare_url(changelog: str, version: str) -> str | None:
    """Lien de comparaison avec la version précédente (« [1.2.0]: …/compare/v1.1.0...v1.2.0 »), s'il existe."""
    match = re.search(rf"^\[{re.escape(version)}\]:\s*(\S+/compare/\S+)", changelog, re.M)
    return match.group(1) if match else None


def language_block(language: str, version: str, changelog: str, repository: str) -> str:
    texts = TEXTS[language]
    section = changelog_section(changelog, version)
    if section is None and "-" in version:
        section = changelog_section(changelog, "Unreleased")
    if not section:
        raise ValueError(f"Section « ## [{version}] » absente ou vide dans {texts['changelog']}.")
    raw = f"https://raw.githubusercontent.com/{repository}/main/packaging"
    tap = f"{repository.split('/')[0]}/easy-ci"
    lines = [
        f"## {texts['whats_new']}",
        "",
        section,
        "",
        f"## {texts['downloads']}",
        "",
        f"| {texts['system']} | {texts['file']} |",
        "|---|---|",
        f"| {texts['macos_arm']} | `EasyCI-macOS-ARM64.zip` |",
        "| macOS Intel | `EasyCI-macOS-X64.zip` |",
        "| Windows 10 / 11 | `EasyCI-Windows-X64.zip` |",
        "| Linux x64 | `EasyCI-Linux-X64.zip` |",
        "",
        f"## {texts['install']}",
        "",
        "```bash",
        f"# {texts['macos_comment'].format(tap=tap)}",
        f"curl -fsSL {raw}/macos/install.sh | bash",
        "# Linux",
        f"curl -fsSL {raw}/linux/install.sh | bash",
        "```",
        "",
        "```powershell",
        "# Windows (PowerShell)",
        f"irm {raw}/windows/install.ps1 | iex",
        "```",
        "",
        texts["after"],
    ]
    url = compare_url(changelog, version)
    if url:
        lines += ["", texts["compare"].format(url=url)]
    return f"<!-- lang:{language} -->\n" + "\n".join(lines) + "\n<!-- /lang -->"


def release_notes(version: str, repository: str, root: Path = ROOT) -> str:
    blocks = [language_block(language, version, (root / TEXTS[language]["changelog"]).read_text(encoding="utf-8"), repository) for language in ("fr", "en")]
    return "\n\n---\n\n".join(blocks) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("version", help="version sans « v » (ex. 0.3.0)")
    parser.add_argument("--repository", default="rodolphe37/easy-ci", help="dépôt GitHub propriétaire/nom")
    args = parser.parse_args()
    # Sous Windows, la sortie redirigée vers un fichier serait sinon encodée en cp1252.
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        sys.stdout.write(release_notes(args.version.removeprefix("v"), args.repository))
    except ValueError as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
