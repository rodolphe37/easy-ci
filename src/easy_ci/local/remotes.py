"""Rapprochement d'une URL de remote Git avec un dépôt GitHub, GitLab ou Bitbucket."""

from __future__ import annotations

import re
from urllib.parse import urlparse

from easy_ci.providers import GITLAB, ProviderHosts, clone_base_url, hostname, provider_for_host

_SCP_LIKE = re.compile(r"^(?:[^@/]+@)?([^:/]+):(?!//)(.+)$")  # git@github.com:owner/repo.git


def parse_remote_url(url: str) -> tuple[str, str] | None:
    """URL de remote → (hôte en minuscules, chemin sans « .git »). None si ce n'est pas un remote réseau."""
    value = url.strip()
    if not value:
        return None
    if "://" in value:
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https", "ssh", "git"):
            return None
        host, path = parsed.hostname or "", parsed.path
    else:
        match = _SCP_LIKE.match(value)
        if not match or value.startswith(("/", ".", "~")):
            return None
        host, path = match.group(1), match.group(2)
    path = path.strip("/").removesuffix(".git").strip("/")
    # Bitbucket/GitLab en SSH sur un port personnalisé : « ssh://git@host:7999/scm/... »
    path = re.sub(r"^scm/", "", path)
    if not host or "/" not in path:
        return None
    return host.lower().removeprefix("www."), path


def match_remote(url: str, hosts: ProviderHosts | None = None) -> tuple[str, str] | None:
    """URL de remote → (fournisseur, chemin complet du dépôt) si l'hébergeur est connu."""
    parsed = parse_remote_url(url)
    if parsed is None:
        return None
    host, path = parsed
    provider = provider_for_host(host, hosts)
    if provider is None:
        return None
    segments = path.split("/")
    if provider != GITLAB:
        segments = segments[:2]
    if len(segments) < 2:
        return None
    return provider, "/".join(segments)


def clone_urls(provider: str, full_name: str, host: str | None = None) -> dict[str, str]:
    """URL de clonage HTTPS et SSH d'un dépôt, sur l'instance `host` le cas échéant."""
    base = clone_base_url(provider, host)
    return {"https": f"{base}/{full_name}.git", "ssh": f"git@{hostname(base)}:{full_name}.git"}
