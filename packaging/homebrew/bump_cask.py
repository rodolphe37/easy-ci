#!/usr/bin/env python3
"""Met à jour la version et les empreintes SHA-256 de Casks/easy-ci.rb.

Appelé par .github/workflows/release.yml après chaque version. Substitutions ciblées (et non
régénération complète) pour conserver la mise en forme et les commentaires du cask. Échoue
bruyamment si un motif ne correspond pas exactement une fois : un script de CI qui modifie un
fichier ne doit jamais échouer en silence.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

DEFAULT_CASK = Path(__file__).resolve().parents[2] / "Casks" / "easy-ci.rb"


def bump(text: str, version: str, arm_sha256: str, intel_sha256: str) -> str:
    for name, digest in (("arm", arm_sha256), ("intel", intel_sha256)):
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError(f"Empreinte {name} invalide (64 caractères hexadécimaux attendus) : {digest!r}")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError(f"Version invalide (1.2.3 attendu, sans « v ») : {version!r}")
    text, n_version = re.subn(r'version "[^"]*"', f'version "{version}"', text, count=1)
    text, n_arm = re.subn(r'arm:\s+"[0-9a-f]{64}"', f'arm:   "{arm_sha256}"', text, count=1)
    text, n_intel = re.subn(r'intel: "[0-9a-f]{64}"', f'intel: "{intel_sha256}"', text, count=1)
    if (n_version, n_arm, n_intel) != (1, 1, 1):
        raise ValueError(f"Une correspondance exacte attendue pour version/arm/intel, obtenu {n_version}/{n_arm}/{n_intel} : le format du cask a changé ?")
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="ex. 0.2.0 (sans « v »)")
    parser.add_argument("--arm-sha256", required=True)
    parser.add_argument("--intel-sha256", required=True)
    parser.add_argument("--cask-path", default=str(DEFAULT_CASK))
    args = parser.parse_args()

    path = Path(args.cask_path)
    try:
        path.write_text(bump(path.read_text(), args.version, args.arm_sha256.lower(), args.intel_sha256.lower()))
    except ValueError as exc:
        sys.exit(str(exc))
    print(f"{path} → version {args.version}")


if __name__ == "__main__":
    main()
