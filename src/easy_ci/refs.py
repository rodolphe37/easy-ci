"""Lecture d'une référence de dépôt saisie par l'utilisateur (nom ou URL, GitHub / GitLab / Bitbucket)."""

from __future__ import annotations

import re
from urllib.parse import urlparse

from easy_ci.errors import EasyCIError
from easy_ci.providers import BITBUCKET, GITHUB, GITLAB

_SEGMENT = re.compile(r"^[A-Za-z0-9_.-]+$")
_SSH = re.compile(r"^(?:ssh://)?git@([^:/]+)[:/](.+?)(?:\.git)?/?$")


def parse_repository_reference(reference: str, provider: str | None = None, gitlab_hosts: tuple[str, ...] = ()) -> tuple[str, str]:
    """Renvoie (fournisseur, chemin complet).

    Accepte « propriétaire/dépôt » (GitLab : « groupe/sous-groupe/projet »), les URL https et ssh.
    Sans URL, le fournisseur choisi dans l'interface (`provider`) est utilisé.
    """
    value = reference.strip().rstrip("/")
    host, path = None, value

    ssh = _SSH.match(value)
    if ssh:
        host, path = ssh.group(1).lower(), ssh.group(2)
    elif "://" in value or value.split("/", 1)[0].count(".") >= 1:
        parsed = urlparse(value if "://" in value else f"https://{value}")
        host, path = (parsed.hostname or "").lower(), parsed.path

    if host:
        host = host.removeprefix("www.")
        gitlab_names = {urlparse(h).hostname or h for h in gitlab_hosts}
        if host == "github.com":
            provider = GITHUB
        elif host == "bitbucket.org":
            provider = BITBUCKET
        elif host == "gitlab.com" or host in gitlab_names:
            provider = GITLAB
        else:
            raise EasyCIError(f"Hébergeur « {host} » non reconnu. Connectez d'abord l'instance GitLab correspondante.")

    provider = provider or GITHUB
    segments = [s for s in path.strip("/").removesuffix(".git").split("/") if s]
    # Les URL contiennent souvent une suite (…/-/pipelines, …/actions, …/src/main) : on ne garde que le dépôt.
    if provider == GITLAB:
        if "-" in segments:
            segments = segments[: segments.index("-")]
        max_segments = 20
    else:
        if host:
            segments = segments[:2]
        max_segments = 2

    if len(segments) < 2 or len(segments) > max_segments or not all(_SEGMENT.match(s) and set(s) != {"."} for s in segments):
        raise EasyCIError("Format non reconnu. Utilisez « propriétaire/dépôt » ou l'URL du dépôt.")
    return provider, "/".join(segments)
