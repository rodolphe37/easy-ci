#!/usr/bin/env python3
"""Change la version d'Easy CI partout où elle est déclarée (pyproject.toml, src/easy_ci/__init__.py, frontend/package.json).

    python scripts/bump_version.py 0.2.0

Affiche ensuite les commandes pour commiter et créer le tag qui déclenche la publication
(.github/workflows/release.yml vérifie que le tag et le code portent la même version).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    (ROOT / "pyproject.toml", r'(?m)^(version\s*=\s*")[^"]+(")'),
    (ROOT / "src" / "easy_ci" / "__init__.py", r'(__version__\s*=\s*")[^"]+(")'),
    (ROOT / "frontend" / "package.json", r'(?m)^(  "version":\s*")[^"]+(")'),
]


def main() -> None:
    if len(sys.argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?", sys.argv[1]):
        sys.exit("Usage : python scripts/bump_version.py 1.2.3  (ou 1.2.3-beta.1)")
    version = sys.argv[1]
    for path, pattern in TARGETS:
        text, count = re.subn(pattern, rf"\g<1>{version}\g<2>", path.read_text(), count=1)
        if count != 1:
            sys.exit(f"Version introuvable dans {path.relative_to(ROOT)} : format inattendu.")
        path.write_text(text)
        print(f"{path.relative_to(ROOT)} → {version}")
    print(f"\nPensez à déplacer les entrées « Unreleased » de CHANGELOG.md sous [{version}].")
    print(f"\nPuis :\n  git commit -am \"chore: version {version}\"\n  git tag v{version}\n  git push origin main v{version}")


if __name__ == "__main__":
    main()
