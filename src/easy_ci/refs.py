"""Lecture d'une référence de dépôt saisie par l'utilisateur (nom ou URL, GitHub / GitLab / Bitbucket)."""

from __future__ import annotations

import re
from urllib.parse import urlparse

from easy_ci.errors import EasyCIError
from easy_ci.i18n import tr
from easy_ci.providers import GITHUB, GITLAB, ProviderHosts, provider_for_host

_SEGMENT = re.compile(r"^[A-Za-z0-9_.-]+$")
# Forme « scp » uniquement (« git@hote:chemin ») : ici le « : » sépare l'hôte du chemin.
# Les URL « ssh://… » passent par urlparse, qui sait, lui, qu'un « : » y introduit un port.
_SSH = re.compile(r"^git@([^:/]+)[:/](.+?)(?:\.git)?/?$")


def parse_repository_reference(reference: str, provider: str | None = None, hosts: ProviderHosts | None = None) -> tuple[str, str]:
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
        matched = provider_for_host(host, hosts)
        if matched is None:
            raise EasyCIError(tr("Hébergeur « {host} » non reconnu. Connectez d'abord l'instance GitLab correspondante.", host=host))
        provider = matched

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
        raise EasyCIError(tr("Format non reconnu. Utilisez « propriétaire/dépôt » ou l'URL du dépôt."))
    return provider, "/".join(segments)
