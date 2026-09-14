from __future__ import annotations

import argparse
import sys

from easy_ci import __version__


def main() -> None:
    parser = argparse.ArgumentParser(prog="easy-ci", description="Superviser et piloter vos pipelines CI/CD")
    parser.add_argument("--dev", action="store_true", help="charger l'interface depuis le serveur Vite (npm run dev)")
    parser.add_argument("--debug", action="store_true", help="activer les outils de développement du navigateur")
    parser.add_argument("--version", action="version", version=f"Easy CI {__version__}")
    parser.add_argument("--self-check", action="store_true", help="vérifier l'installation (interface, moteur de rendu) sans ouvrir de fenêtre")
    args = parser.parse_args()

    if args.self_check:
        from easy_ci.selfcheck import run_self_check

        sys.exit(run_self_check())

    from easy_ci.app import run

    sys.exit(run(dev=args.dev, debug=args.debug))


if __name__ == "__main__":
    main()
