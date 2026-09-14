"""Serveur HTTP local exposant l'API pour développer l'interface dans un navigateur.

Vite (port 5173) redirige /api vers ce serveur. Réservé au développement : il écoute
uniquement sur 127.0.0.1 et refuse les requêtes venant d'autres origines.
"""

from __future__ import annotations

import argparse
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from easy_ci.api import Api

ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}


def make_handler(api: Api) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/api/call":
                self._send(404, {"ok": False, "error": {"code": "not_found", "message": "Route inconnue"}})
                return
            origin = self.headers.get("Origin")
            # Le Content-Type JSON impose un « preflight » CORS qu'on ne satisfait pas :
            # une page web tierce ne peut donc pas déclencher d'action sur ce serveur.
            if (origin and origin not in ALLOWED_ORIGINS) or "application/json" not in self.headers.get("Content-Type", ""):
                self._send(403, {"ok": False, "error": {"code": "forbidden", "message": "Origine refusée"}})
                return
            length = int(self.headers.get("Content-Length", "0"))
            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                self._send(400, {"ok": False, "error": {"code": "bad_request", "message": "JSON invalide"}})
                return
            self._send(200, api.call(payload.get("method", ""), payload.get("params"), payload.get("language")))

        def _send(self, status: int, body: dict) -> None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            logging.getLogger("easy_ci.devserver").debug(format, *args)

    return Handler


def serve(port: int = 8765) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(Api()))
    print(f"API Easy CI disponible sur http://127.0.0.1:{port} (Ctrl+C pour arrêter)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serveur d'API Easy CI pour le développement web")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    serve(args.port)


if __name__ == "__main__":
    main()
