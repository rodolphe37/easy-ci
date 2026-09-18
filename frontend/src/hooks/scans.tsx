import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useDeferredValue, useMemo, useRef, type ReactNode } from "react";
import { isActive } from "@/components/status";
import { api } from "@/lib/api";
import type { Account, ProviderId, RepoScan, Repository, Run } from "@/lib/types";
import { timeKey } from "@/lib/utils";
import { useSession, useSettings } from "./session";

/** Limite le nombre de scans simultanés pour ménager le quota de chaque fournisseur. */
function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active += 1;
    queue.shift()!();
  };
  return <T,>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() =>
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          }),
      );
      next();
    });
}

export interface RepoEntry {
  repo: Repository;
  scan: RepoScan | undefined;
  loading: boolean;
  error: Error | null;
}

export type RecentRun = Run & { provider: ProviderId; repository: string; repoKey: string };

interface ScanContextValue {
  accounts: Account[];
  repositories: Repository[];
  entries: RepoEntry[];
  byKey: Map<string, RepoEntry>;
  isLoadingRepos: boolean;
  /** Erreurs de chargement des dépôts, par fournisseur (les autres restent affichés). */
  reposErrors: { provider: ProviderId; error: Error }[];
  scanned: number;
  total: number;
  refreshAll: () => Promise<void>;
  refreshRepo: (key: string) => Promise<void>;
  /** Exécutions récentes de tous les dépôts, les plus récentes d'abord. */
  recentRuns: RecentRun[];
}

/** État d'actualisation, séparé des données : il change à chaque requête, et seule la barre du haut l'affiche. */
interface ScanStatusValue {
  isRefreshing: boolean;
  lastUpdatedAt: number | null;
}

const ScanContext = createContext<ScanContextValue | null>(null);
const ScanStatusContext = createContext<ScanStatusValue>({ isRefreshing: false, lastUpdatedAt: null });

const ACTIVE_REFRESH_MS = 8_000;
/** Rythme des appels à poll_activity ; le moteur ne sonde que les dépôts dus, selon le quota de chaque fournisseur. */
const LIVE_TICK_MS = 5_000;

/** Dépôts à sonder : ceux qui ont une CI et aucune exécution en cours (celles-ci sont déjà suivies toutes les 8 s). */
function liveKeys(entries: RepoEntry[]): string[] {
  return entries
    .filter((entry) => entry.scan?.has_ci && !entry.scan.workflows.some((wf) => isActive(wf.latest_run?.state)))
    .map((entry) => entry.repo.key);
}

export function ScanProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { settings } = useSettings();
  const limiters = useRef(new Map<ProviderId, ReturnType<typeof createLimiter>>()).current;
  const taggedRuns = useRef(new WeakMap<Run[], RecentRun[]>()).current;
  const intervalMs = (settings?.refresh_interval ?? 60) * 1000;
  const accounts = useMemo(() => session?.accounts ?? [], [session?.accounts]);

  const limiter = (provider: ProviderId) => {
    if (!limiters.has(provider)) limiters.set(provider, createLimiter(6));
    return limiters.get(provider)!;
  };

  const repoQueries = useQueries({
    queries: accounts.map((account) => ({
      queryKey: ["repositories", account.provider],
      queryFn: () => api.listRepositories(account.provider),
      staleTime: 5 * 60_000,
      refetchInterval: 10 * 60_000,
    })),
  });

  const repoDataKey = repoQueries.map((q) => q.dataUpdatedAt).join("|");
  const hidden = settings?.hidden_repositories;
  const repositories = useMemo(() => {
    const hiddenKeys = new Set((hidden ?? []).map((key) => key.toLowerCase()));
    return repoQueries
      .flatMap((query) => query.data ?? [])
      .filter((repo) => (settings?.include_archived || !repo.archived) && !hiddenKeys.has(repo.key.toLowerCase()));
  }, [repoDataKey, settings?.include_archived, hidden]);

  const scans = useQueries({
    queries: repositories.map((repo) => ({
      queryKey: ["scan", repo.key],
      queryFn: () => limiter(repo.provider)(() => api.scanRepository({ provider: repo.provider, full_name: repo.full_name })),
      staleTime: 10_000,
      // Fenêtre réduite ou en arrière-plan : on continue d'actualiser pour les notifications système.
      refetchIntervalInBackground: settings?.notifications_enabled !== false,
      refetchInterval: (query: { state: { data?: RepoScan } }) => {
        const scan = query.state.data;
        if (scan?.workflows.some((wf) => isActive(wf.latest_run?.state))) return ACTIVE_REFRESH_MS;
        if (!intervalMs) return false;
        // Les dépôts sans CI changent rarement : on les revérifie moins souvent.
        return scan && !scan.has_ci ? intervalMs * 5 : intervalMs;
      },
    })),
  });

  // Les données ne changent qu'à l'arrivée d'une réponse : le début et la fin d'une requête (fetchStatus)
  // ne concernent que l'indicateur d'actualisation et ne doivent pas redessiner toutes les pages.
  const scansKey = scans.map((s) => `${s.dataUpdatedAt}:${s.errorUpdatedAt}:${s.status}`).join("|");
  const reposStatusKey = repoQueries.map((q) => `${q.dataUpdatedAt}:${q.errorUpdatedAt}:${q.status}`).join("|");
  const isRefreshing = repoQueries.some((q) => q.isFetching) || scans.some((s) => s.isFetching);
  const lastUpdatedAt = scans.reduce<number | null>((latest, s) => (s.dataUpdatedAt && s.dataUpdatedAt > (latest ?? 0) ? s.dataUpdatedAt : latest), null);

  const refreshAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["repositories"] });
    await queryClient.invalidateQueries({ queryKey: ["scan"] });
  }, [queryClient]);
  const refreshRepo = useCallback(
    async (key: string) => {
      await queryClient.invalidateQueries({ queryKey: ["scan", key] });
    },
    [queryClient],
  );

  const value = useMemo<ScanContextValue>(() => {
    const entries: RepoEntry[] = repositories.map((repo, index) => ({
      repo,
      scan: scans[index]?.data,
      loading: scans[index]?.isPending ?? true,
      error: (scans[index]?.error as Error | null) ?? null,
    }));
    const recentRuns = entries
      .flatMap((entry) => {
        const runs = entry.scan?.recent_runs;
        if (!runs) return [];
        // Le partage structurel de TanStack Query conserve le tableau tant qu'il ne change pas : les lignes
        // déjà affichées gardent la même exécution et ne sont pas redessinées (RunRow est mémoïsé).
        let tagged = taggedRuns.get(runs);
        if (!tagged) {
          tagged = runs.map((run) => ({ ...run, provider: entry.repo.provider, repository: entry.repo.full_name, repoKey: entry.repo.key }));
          taggedRuns.set(runs, tagged);
        }
        return tagged;
      })
      .sort((a, b) => timeKey(b.created_at) - timeKey(a.created_at));

    return {
      accounts,
      repositories,
      entries,
      byKey: new Map(entries.map((entry) => [entry.repo.key, entry])),
      isLoadingRepos: accounts.length > 0 && repoQueries.every((q) => q.isPending),
      reposErrors: repoQueries.flatMap((q, index) => (q.error && accounts[index] ? [{ provider: accounts[index].provider, error: q.error as Error }] : [])),
      scanned: scans.filter((s) => !s.isPending).length,
      total: repositories.length,
      recentRuns,
      refreshAll,
      refreshRepo,
    };
    // `scans` et `repoQueries` changent de référence à chaque rendu ; on dépend de leur contenu utile.
  }, [accounts, repositories, scansKey, reposStatusKey, refreshAll, refreshRepo]);

  useLiveActivity(value.entries, settings?.live_updates !== false, settings?.notifications_enabled !== false);

  // Les pages se redessinent en arrière-plan (rendu interruptible) : l'arrivée d'un scan ne bloque
  // jamais un clic ou une saisie, et plusieurs scans arrivés coup sur coup ne coûtent qu'un rendu.
  const deferred = useDeferredValue(value);
  const status = useMemo(() => ({ isRefreshing, lastUpdatedAt }), [isRefreshing, lastUpdatedAt]);

  return (
    <ScanContext.Provider value={deferred}>
      <ScanStatusContext.Provider value={status}>{children}</ScanStatusContext.Provider>
    </ScanContext.Provider>
  );
}

/**
 * Temps réel : toutes les 5 s, le moteur compare l'empreinte des exécutions récentes des dépôts dus
 * (une requête légère, gratuite sur GitHub tant que rien ne change). Dès qu'une empreinte change, le scan
 * du dépôt, sa liste d'exécutions et l'exécution affichée sont rechargés : une exécution qui démarre apparaît en quelques secondes.
 */
function useLiveActivity(entries: RepoEntry[], enabled: boolean, inBackground: boolean) {
  const queryClient = useQueryClient();
  const keys = useMemo(() => liveKeys(entries), [entries]);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  // Dernière empreinte connue de chaque dépôt, conservée même quand il sort de la liste (exécution en cours) :
  // à son retour, une différence déclenche un scan qui rattrape ce qui a pu démarrer entre-temps.
  const known = useRef(new Map<string, string>());

  useQuery({
    queryKey: ["activity"],
    queryFn: async () => {
      const { fingerprints, probed } = await api.pollActivity(keysRef.current);
      for (const [key, fingerprint] of Object.entries(fingerprints)) {
        const previous = known.current.get(key);
        known.current.set(key, fingerprint);
        if (previous === undefined || previous === fingerprint) continue;
        void queryClient.invalidateQueries({ queryKey: ["scan", key] });
        void queryClient.invalidateQueries({ queryKey: ["runs", key] });
        void queryClient.invalidateQueries({ queryKey: ["run", key] });
      }
      return probed;
    },
    enabled: enabled && keys.length > 0,
    refetchInterval: LIVE_TICK_MS,
    refetchIntervalInBackground: inBackground,
    refetchOnWindowFocus: false,
    retry: false,
    gcTime: 0,
  });
}

export function useScans() {
  const context = useContext(ScanContext);
  if (!context) throw new Error("useScans must be used within <ScanProvider>");
  return context;
}

export function useScanStatus() {
  return useContext(ScanStatusContext);
}

export function useRepoEntry(key: string) {
  return useScans().byKey.get(key);
}
