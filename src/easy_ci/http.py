"""Client HTTP JSON commun aux fournisseurs (GitHub, GitLab, Bitbucket).

- requêtes conditionnelles (ETag) : une réponse 304 réutilise la donnée en cache ;
- pagination par en-tête Link ou par champ « next » dans la réponse ;
- suivi du quota d'appels et erreurs traduites en exceptions métier.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

import httpx

from easy_ci import __version__
from easy_ci.errors import AuthError, ForbiddenError, GitHubError, NetworkError, NotFoundError, RateLimitError

# (limite, restant, réinitialisation) selon les conventions de chaque fournisseur.
_RATE_LIMIT_HEADERS = [
    ("x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"),
    ("ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"),
]


class ApiClient:
    def __init__(
        self,
        base_url: str,
        *,
        label: str,
        headers: dict[str, str] | None = None,
        auth: httpx.Auth | tuple[str, str] | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 20.0,
    ) -> None:
        self.label = label
        self._http = httpx.Client(
            base_url=base_url,
            headers={"User-Agent": f"easy-ci/{__version__}", **(headers or {})},
            auth=auth,
            timeout=timeout,
            transport=transport,
            follow_redirects=True,
        )
        self._etag_cache: dict[str, tuple[str, Any]] = {}
        self._lock = threading.Lock()
        self.rate_limit: dict[str, int] | None = None

    def close(self) -> None:
        self._http.close()

    # -- Requêtes ---------------------------------------------------------

    def request(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        try:
            response = self._http.request(method, url, params=params, json=json, headers=headers)
        except httpx.TimeoutException as exc:
            raise NetworkError(f"{self.label} ne répond pas (délai dépassé).") from exc
        except httpx.HTTPError as exc:
            raise NetworkError(f"Impossible de joindre {self.label}. Vérifiez votre connexion.") from exc
        self._track_rate_limit(response)
        return response

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        data, _ = self.get_json_with_response(url, params)
        return data

    def get_text(self, url: str, params: dict[str, Any] | None = None) -> str:
        response = self.request("GET", url, params=params)
        self.raise_for_status(response)
        return response.text

    def exists(self, url: str, params: dict[str, Any] | None = None) -> bool:
        response = self.request("HEAD", url, params=params)
        if response.status_code == 404:
            return False
        self.raise_for_status(response)
        return True

    def post(self, url: str, json: Any = None, params: dict[str, Any] | None = None) -> Any:
        response = self.request("POST", url, json=json, params=params)
        self.raise_for_status(response)
        if response.status_code == 204 or not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            return None

    def paginate(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        *,
        key: str | None = None,
        max_pages: int = 10,
        next_from_body: Callable[[Any], str | None] | None = None,
    ) -> list[Any]:
        items: list[Any] = []
        next_url: str | None = url
        next_params = params
        for _ in range(max_pages):
            if not next_url:
                break
            data, response = self.get_json_with_response(next_url, next_params)
            items.extend(data[key] if key else data)
            if next_from_body is not None:
                next_url = next_from_body(data)
            else:
                next_url = response.links.get("next", {}).get("url") if response is not None else None
            next_params = None  # l'URL « next » contient déjà les paramètres
        return items

    def get_json_with_response(self, url: str, params: dict[str, Any] | None = None) -> tuple[Any, httpx.Response]:
        cache_key = url + "?" + "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
        with self._lock:
            cached = self._etag_cache.get(cache_key)
        headers = {"If-None-Match": cached[0]} if cached else None

        response = self.request("GET", url, params=params, headers=headers)
        if response.status_code == 304 and cached:
            return cached[1], response

        self.raise_for_status(response)
        data = response.json()
        etag = response.headers.get("etag")
        if etag:
            with self._lock:
                self._etag_cache[cache_key] = (etag, data)
        return data, response

    # -- Interne ----------------------------------------------------------

    def _track_rate_limit(self, response: httpx.Response) -> None:
        headers = response.headers
        for limit_header, remaining_header, reset_header in _RATE_LIMIT_HEADERS:
            if limit_header in headers and remaining_header in headers:
                try:
                    self.rate_limit = {
                        "limit": int(headers[limit_header]),
                        "remaining": int(headers[remaining_header]),
                        "reset_at": int(headers.get(reset_header, "0") or 0),
                    }
                except ValueError:
                    pass
                return

    def raise_for_status(self, response: httpx.Response) -> None:
        if response.is_success:
            return
        status = response.status_code
        try:
            body = response.json()
        except ValueError:
            body = None
        detail: Any = ""
        if isinstance(body, dict):
            # GitHub/GitLab : {"message": …} ; Bitbucket : {"error": {"message": …}}
            error = body.get("error")
            detail = body.get("message") or (error.get("message") if isinstance(error, dict) else error) or ""
            # GitHub 422 : {"message": "Validation Failed", "errors": [{"message": "A pull request already exists…"}]}
            extra = [e.get("message") for e in body.get("errors") or [] if isinstance(e, dict) and e.get("message")]
            if extra:
                detail = f"{detail} : {'; '.join(extra)}" if detail else "; ".join(extra)
        elif body is None:
            detail = response.text[:200]
        detail = detail if isinstance(detail, str) else str(detail)

        if status == 401:
            raise AuthError(f"Identifiants {self.label} invalides ou expirés.", status=status)
        remaining = response.headers.get("x-ratelimit-remaining") or response.headers.get("ratelimit-remaining")
        if status == 429 or (status == 403 and remaining == "0"):
            reset_at = int(response.headers.get("x-ratelimit-reset") or response.headers.get("ratelimit-reset") or 0)
            raise RateLimitError(f"Limite d'appels à l'API {self.label} atteinte.", reset_at=reset_at, status=status)
        if status == 403:
            raise ForbiddenError(f"Accès refusé par {self.label}. Vérifiez les permissions du token. ({detail})", status=status)
        if status == 404:
            raise NotFoundError(detail or "Ressource introuvable.", status=status)
        raise GitHubError(f"Erreur {self.label} {status} : {detail}", status=status)
