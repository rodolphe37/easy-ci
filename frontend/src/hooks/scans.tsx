import { useQueries, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { isActive } from "@/components/status";
import { api } from "@/lib/api";
import type { Account, ProviderId, RepoScan, Repository, Run } from "@/lib/types";
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
  isRefreshing: boolean;
  lastUpdatedAt: number | null;
  refreshAll: () => Promise<void>;
  refreshRepo: (key: string) => Promise<void>;
  /** Exécutions récentes de tous les dépôts, les plus récentes d'abord. */
  recentRuns: RecentRun[];
}

const ScanContext = createContext<ScanContextValue | null>(null);

const ACTIVE_REFRESH_MS = 8_000;

export function ScanProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { settings } = useSettings();
  const limiters = useRef(new Map<ProviderId, ReturnType<typeof createLimiter>>()).current;
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
      refetchInterval: (query: { state: { data?: RepoScan } }) => {
        const scan = query.state.data;
        if (scan?.workflows.some((wf) => isActive(wf.latest_run?.state))) return ACTIVE_REFRESH_MS;
        if (!intervalMs) return false;
        // Les dépôts sans CI changent rarement : on les revérifie moins souvent.
        return scan && !scan.has_ci ? intervalMs * 5 : intervalMs;
      },
    })),
  });

  const scansKey = scans.map((s) => `${s.dataUpdatedAt}:${s.fetchStatus}:${s.status}`).join("|");
  const reposStatusKey = repoQueries.map((q) => `${q.fetchStatus}:${q.status}`).join("|");

  const value = useMemo<ScanContextValue>(() => {
    const entries: RepoEntry[] = repositories.map((repo, index) => ({
      repo,
      scan: scans[index]?.data,
      loading: scans[index]?.isPending ?? true,
      error: (scans[index]?.error as Error | null) ?? null,
    }));
    const updatedTimes = scans.map((s) => s.dataUpdatedAt).filter(Boolean);
    const recentRuns = entries
      .flatMap((entry) =>
        (entry.scan?.recent_runs ?? []).map((run) => ({ ...run, provider: entry.repo.provider, repository: entry.repo.full_name, repoKey: entry.repo.key })),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    return {
      accounts,
      repositories,
      entries,
      byKey: new Map(entries.map((entry) => [entry.repo.key, entry])),
      isLoadingRepos: accounts.length > 0 && repoQueries.every((q) => q.isPending),
      reposErrors: repoQueries.flatMap((q, index) => (q.error && accounts[index] ? [{ provider: accounts[index].provider, error: q.error as Error }] : [])),
      scanned: scans.filter((s) => !s.isPending).length,
      total: repositories.length,
      isRefreshing: repoQueries.some((q) => q.isFetching) || scans.some((s) => s.isFetching),
      lastUpdatedAt: updatedTimes.length ? Math.max(...updatedTimes) : null,
      recentRuns,
      refreshAll: async () => {
        await queryClient.invalidateQueries({ queryKey: ["repositories"] });
        await queryClient.invalidateQueries({ queryKey: ["scan"] });
      },
      refreshRepo: async (key: string) => {
        await queryClient.invalidateQueries({ queryKey: ["scan", key] });
      },
    };
    // `scans` et `repoQueries` changent de référence à chaque rendu ; on dépend de leur contenu utile.
  }, [accounts, repositories, scansKey, reposStatusKey]);

  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

export function useScans() {
  const context = useContext(ScanContext);
  if (!context) throw new Error("useScans doit être utilisé dans <ScanProvider>");
  return context;
}

export function useRepoEntry(key: string) {
  return useScans().byKey.get(key);
}
