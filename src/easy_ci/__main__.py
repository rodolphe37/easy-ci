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
    parser.add_argument("--test-notification", action="store_true", help="afficher une notification système d'essai et indiquer le mécanisme utilisé")
    args = parser.parse_args()

    if args.test_notification:
        import json

        from easy_ci.notifications import Notifier

        result = Notifier().notify("Easy CI", "Notification d'essai / Test notification")
        if sys.stdout is not None:
            print(json.dumps(result, ensure_ascii=False))
        sys.exit(0 if result["delivered"] else 1)

    if args.self_check:
        from easy_ci.selfcheck import run_self_check

        sys.exit(run_self_check())

    from easy_ci.app import run

    sys.exit(run(dev=args.dev, debug=args.debug))


if __name__ == "__main__":
    main()
