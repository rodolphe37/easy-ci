import { useSyncExternalStore } from "react";

// Une seule horloge partagée : tous les compteurs « il y a… » et durées live se mettent à jour ensemble.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Heure courante de l'horloge partagée, sans s'y abonner. */
export function currentNow(): number {
  return timer ? now : Date.now();
}

/**
 * Heure courante, rafraîchie toutes les `granularityMs` : le composant n'est redessiné que lorsque
 * l'heure change de tranche (« il y a 3 h » n'a pas besoin d'un rendu par seconde).
 * `Infinity` : jamais redessiné par l'horloge (durée figée d'une exécution terminée).
 */
export function useNow(granularityMs = 1000): number {
  useSyncExternalStore(subscribe, () => (Number.isFinite(granularityMs) ? Math.floor(now / granularityMs) : 0));
  return currentNow();
}

/** Tranche adaptée à l'âge d'une date : à la seconde pendant 90 s, puis toutes les 10 s, puis à la minute après une heure. */
export function granularityFor(date: string | null | undefined): number {
  if (!date) return Number.POSITIVE_INFINITY;
  const age = Math.abs(currentNow() - Date.parse(date));
  return age < 90_000 ? 1000 : age < 3_600_000 ? 10_000 : 60_000;
}
