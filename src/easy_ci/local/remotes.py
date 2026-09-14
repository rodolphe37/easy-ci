"""Rapprochement d'une URL de remote Git avec un dépôt GitHub, GitLab ou Bitbucket."""

from __future__ import annotations

import re
from urllib.parse import urlparse

from easy_ci.providers import BITBUCKET, GITHUB, GITLAB

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


def match_remote(url: str, gitlab_hosts: tuple[str, ...] = ()) -> tuple[str, str] | None:
    """URL de remote → (fournisseur, chemin complet du dépôt) si l'hébergeur est connu."""
    parsed = parse_remote_url(url)
    if parsed is None:
        return None
    host, path = parsed
    if host in ("github.com", "ssh.github.com"):
        provider = GITHUB
    elif host in ("bitbucket.org", "altssh.bitbucket.org"):
        provider = BITBUCKET
    elif host in ("gitlab.com", "altssh.gitlab.com") or host in {_hostname(h) for h in gitlab_hosts}:
        provider = GITLAB
    else:
        return None
    segments = path.split("/")
    if provider != GITLAB:
        segments = segments[:2]
    if len(segments) < 2:
        return None
    return provider, "/".join(segments)


def _hostname(host: str) -> str:
    value = host if "://" in host else f"https://{host}"
    return (urlparse(value).hostname or "").lower().removeprefix("www.")


def clone_urls(provider: str, full_name: str, host: str | None = None) -> dict[str, str]:
    """URL de clonage HTTPS et SSH d'un dépôt."""
    if provider == GITLAB:
        hostname = _hostname(host or "https://gitlab.com")
        base = (host or "https://gitlab.com").rstrip("/")
        return {"https": f"{base}/{full_name}.git", "ssh": f"git@{hostname}:{full_name}.git"}
    hostname = "bitbucket.org" if provider == BITBUCKET else "github.com"
    return {"https": f"https://{hostname}/{full_name}.git", "ssh": f"git@{hostname}:{full_name}.git"}
