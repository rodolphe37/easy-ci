import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { LocalOverview, LocalStatus, SyncResult } from "@/lib/types";
import { useSettings } from "./session";

const OVERVIEW_KEY = ["local-overview"];

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : String(error);
}

/** Dossiers racines, clones reconnus et outils disponibles. */
export function useLocalProjects() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: OVERVIEW_KEY, queryFn: api.localOverview, staleTime: 60_000 });

  const scan = useMutation({
    mutationFn: api.scanLocalProjects,
    onSuccess: (overview) => queryClient.setQueryData(OVERVIEW_KEY, overview),
    onError: (error) => toast.error("Détection impossible", { description: errorMessage(error) }),
  });

  const byKey = useMemo(() => new Map((query.data?.projects ?? []).map((project) => [project.key, project])), [query.data]);
  return { overview: query.data, isLoading: query.isPending, error: query.error, byKey, scan };
}

export function useLocalStatus(key: string, enabled = true) {
  return useQuery({ queryKey: ["local-status", key], queryFn: () => api.getLocalStatus(key), enabled, staleTime: 5_000, refetchOnWindowFocus: true });
}

export function useLocalActions() {
  const queryClient = useQueryClient();

  const applyOverview = (overview: LocalOverview) => queryClient.setQueryData(OVERVIEW_KEY, overview);
  const applyStatus = (status: LocalStatus) => {
    queryClient.setQueryData(["local-status", status.key], status);
    void queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY });
    void queryClient.invalidateQueries({ queryKey: ["local-diff", status.key] });
  };

  const onError = (title: string) => (error: unknown) => {
    if (error instanceof ApiError && error.code === "link_mismatch") return; // géré par le formulaire
    toast.error(title, { description: errorMessage(error) });
  };

  const addRoot = useMutation({ mutationFn: api.addLocalRoot, onSuccess: applyOverview, onError: onError("Dossier non ajouté") });
  const removeRoot = useMutation({ mutationFn: api.removeLocalRoot, onSuccess: applyOverview, onError: onError("Action impossible") });
  const link = useMutation({
    mutationFn: ({ key, path, force }: { key: string; path: string; force?: boolean }) => api.linkLocalProject(key, path, force),
    onSuccess: (status) => {
      applyStatus(status);
      toast.success("Dossier local lié", { description: status.linked ? status.display_path : undefined });
    },
    onError: onError("Liaison impossible"),
  });
  const unlink = useMutation({
    mutationFn: api.unlinkLocalProject,
    onSuccess: (overview, key) => {
      applyOverview(overview);
      queryClient.setQueryData(["local-status", key], { key, linked: false });
      toast("Dossier local délié", { description: "Le dossier n'est ni modifié ni supprimé." });
    },
    onError: onError("Action impossible"),
  });
  const clone = useMutation({
    mutationFn: ({ key, parent, protocol }: { key: string; parent: string; protocol: "https" | "ssh" }) => api.cloneRepository(key, parent, protocol),
    onSuccess: (status) => {
      applyStatus(status);
      toast.success("Dépôt cloné", { description: status.linked ? status.display_path : undefined });
    },
    onError: onError("Clonage impossible"),
  });
  const sync = useMutation({
    mutationFn: ({ key, pull }: { key: string; pull: boolean }) => api.syncLocalProject(key, pull),
    onSuccess: (result: SyncResult, { pull }) => {
      applyStatus(result.status);
      if (!pull) toast.success("Récupération terminée");
      else if (result.pulled) toast.success("Branche mise à jour");
      else toast(SKIP_MESSAGES[result.skipped_reason ?? "up_to_date"]);
    },
    onError: onError("Synchronisation impossible"),
  });
  const open = useMutation({
    mutationFn: ({ key, target, editorId }: { key: string; target: "folder" | "editor" | "terminal"; editorId?: string | null }) =>
      api.openLocalProject(key, target, editorId),
    onError: onError("Ouverture impossible"),
  });

  return { addRoot, removeRoot, link, unlink, clone, sync, open };
}

export const SKIP_MESSAGES: Record<NonNullable<SyncResult["skipped_reason"]>, string> = {
  up_to_date: "Déjà à jour : aucun nouveau commit sur la branche distante.",
  dirty: "Mise à jour non faite : des modifications locales ne sont pas commitées.",
  diverged: "Mise à jour non faite : vous avez aussi des commits locaux non poussés (branches divergentes).",
  no_upstream: "Mise à jour non faite : la branche locale ne suit aucune branche distante.",
};

/**
 * Récupération automatique en arrière-plan pour tous les projets liés.
 * Mise à jour de la branche seulement si l'option est active, et jamais sur une copie modifiée.
 */
export function useAutoFetch() {
  const { settings } = useSettings();
  const { overview, scan } = useLocalProjects();
  const queryClient = useQueryClient();
  const scanRequested = useRef(false);

  // Au lancement, la liste des clones n'est pas encore connue : on parcourt les dossiers une seule fois.
  useEffect(() => {
    if (overview && overview.roots.length > 0 && overview.scanned_at === null && !scanRequested.current) {
      scanRequested.current = true;
      scan.mutate();
    }
  }, [overview]);

  const minutes = settings?.auto_fetch_minutes ?? 0;
  const pull = settings?.auto_pull ?? false;
  const keys = (overview?.projects ?? []).filter((project) => project.exists).map((project) => project.key);

  useQueries({
    queries: keys.map((key, index) => ({
      queryKey: ["local-auto-fetch", key, pull],
      queryFn: async () => {
        // Décalage pour ne pas lancer tous les fetch en même temps.
        await new Promise((resolve) => setTimeout(resolve, index * 1500));
        try {
          const result = await api.syncLocalProject(key, pull);
          queryClient.setQueryData(["local-status", key], result.status);
          if (result.pulled) toast.success("Projet local mis à jour", { description: key.slice(key.indexOf(":") + 1) });
          return Date.now();
        } catch {
          return Date.now(); // réseau ou authentification : l'utilisateur verra l'erreur en synchronisant à la main
        }
      },
      enabled: minutes > 0 && !overview?.demo,
      staleTime: minutes * 60_000,
      refetchInterval: minutes * 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });
}
