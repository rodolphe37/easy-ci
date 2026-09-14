from __future__ import annotations

import argparse
import sys


def main() -> None:
    parser = argparse.ArgumentParser(prog="easy-ci", description="Superviser et piloter vos pipelines CI/CD")
    parser.add_argument("--dev", action="store_true", help="charger l'interface depuis le serveur Vite (npm run dev)")
    parser.add_argument("--debug", action="store_true", help="activer les outils de développement du navigateur")
    args = parser.parse_args()

    from easy_ci.app import run

    sys.exit(run(dev=args.dev, debug=args.debug))


if __name__ == "__main__":
    main()
