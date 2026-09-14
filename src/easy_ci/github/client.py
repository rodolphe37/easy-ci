"""Client de l'API REST GitHub."""

from __future__ import annotations

import httpx

from easy_ci.http import ApiClient

API_URL = "https://api.github.com"


class GitHubClient(ApiClient):
    def __init__(self, token: str, *, base_url: str = API_URL, transport: httpx.BaseTransport | None = None, timeout: float = 20.0) -> None:
        super().__init__(
            base_url,
            label="GitHub",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            transport=transport,
            timeout=timeout,
        )
