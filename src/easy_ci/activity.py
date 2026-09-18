"""Détection quasi immédiate des exécutions qui démarrent, avancent ou se terminent.

L'interface interroge `poll` toutes les quelques secondes avec la liste des dépôts suivis. Seuls les
dépôts « dus » sont sondés, au rythme permis par le quota de chaque fournisseur ; les autres gardent
leur dernière empreinte, si bien qu'un appel sans sondage ne coûte rien. Quand l'empreinte d'un dépôt
change, l'interface relance son scan complet.

Une sonde reprend la requête des exécutions du scan : GitHub y répond 304 tant que rien ne change
(gratuit pour le quota), et le scan qui suit profite de la réponse mise en cache.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from easy_ci.errors import EasyCIError
from easy_ci.providers import BITBUCKET, GITHUB, GITLAB, repo_key, split_repo_key

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Pace:
    min_interval: float  # secondes entre deux sondes d'un même dépôt
    per_minute: float  # sondes par minute pour l'ensemble des dépôts du fournisseur


# GitHub : les réponses 304 ne sont pas décomptées, on reste sous la limite secondaire (≈ 900 appels/min).
# GitLab.com autorise 2 000 appels/min. Bitbucket Cloud n'en accorde que 1 000 par heure : on reste sobre.
PACES: dict[str, Pace] = {
    GITHUB: Pace(min_interval=10, per_minute=120),
    GITLAB: Pace(min_interval=10, per_minute=60),
    BITBUCKET: Pace(min_interval=30, per_minute=4),
}
DEMO_PACE = Pace(min_interval=5, per_minute=600)
# En dessous de cette part de quota restante, on laisse les appels aux actions de l'utilisateur.
QUOTA_RESERVE = 0.2
MAX_PARALLEL = 6


@dataclass
class _Probe:
    fingerprint: str | None = None
    probed_at: float = float("-inf")


class ActivityWatcher:
    def __init__(self, service_for: Callable[[str], Any], *, demo: Callable[[], bool], clock: Callable[[], float] = time.monotonic) -> None:
        self._service_for = service_for
        self._demo = demo
        self._clock = clock
        self._probes: dict[str, _Probe] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=MAX_PARALLEL, thread_name_prefix="activity")

    def reset(self) -> None:
        """Les empreintes portent sur un compte : elles sont oubliées quand les comptes changent."""
        with self._lock:
            self._probes.clear()

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)

    def poll(self, repositories: list[str]) -> dict[str, Any]:
        now = self._clock()
        keys = list(dict.fromkeys(str(key) for key in repositories))
        by_provider: dict[str, list[tuple[str, str]]] = {}
        for key in keys:
            provider, full_name = split_repo_key(key)
            by_provider.setdefault(provider, []).append((key, full_name))

        due: list[tuple[str, str, str]] = []
        with self._lock:
            # Les dépôts qui ne sont plus suivis sont oubliés.
            for key in set(self._probes) - set(keys):
                del self._probes[key]
            for provider, repos in by_provider.items():
                due.extend((provider, key, full_name) for key, full_name in self._due(provider, repos, now))

        results = self._pool.map(lambda item: (item[1], self._probe(item[0], item[2])), due)
        with self._lock:
            for key, fingerprint in results:
                probe = self._probes.setdefault(key, _Probe())
                probe.probed_at = now
                if fingerprint is not None:
                    probe.fingerprint = fingerprint
            fingerprints = {key: self._probes[key].fingerprint for key in keys if key in self._probes and self._probes[key].fingerprint is not None}
        return {"fingerprints": fingerprints, "probed": len(due)}

    def _due(self, provider: str, repos: list[tuple[str, str]], now: float) -> list[tuple[str, str]]:
        demo = self._demo()
        pace = DEMO_PACE if demo else PACES.get(provider)
        if pace is None or (not demo and self._quota_low(provider)):
            return []
        interval = max(pace.min_interval, len(repos) * 60 / pace.per_minute)
        # Les dépôts sondés il y a le plus longtemps passent en premier, dans la limite du budget par appel.
        waiting = sorted(
            ((key, full_name) for key, full_name in repos if now - self._probes.get(key, _Probe()).probed_at >= interval),
            key=lambda item: self._probes.get(item[0], _Probe()).probed_at,
        )
        return waiting[: max(1, int(pace.per_minute * pace.min_interval / 60))] if not demo else waiting

    def _quota_low(self, provider: str) -> bool:
        try:
            rate = self._service_for(provider).rate_limit()
        except EasyCIError:
            return True
        return bool(rate and rate.get("limit") and rate.get("remaining", 0) < rate["limit"] * QUOTA_RESERVE)

    def _probe(self, provider: str, full_name: str) -> str | None:
        try:
            return self._service_for(provider).run_activity(full_name)
        except EasyCIError as exc:
            # Dépôt inaccessible, réseau coupé, quota atteint : le scan périodique affichera l'erreur.
            log.debug("Sonde d'activité impossible pour %s : %s", repo_key(provider, full_name), exc)
        except Exception:  # une réponse inattendue d'un dépôt ne doit pas priver les autres de leur sonde
            log.exception("Sonde d'activité en échec pour %s", repo_key(provider, full_name))
        return None
