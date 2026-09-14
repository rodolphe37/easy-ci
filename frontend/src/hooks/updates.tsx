import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { UpdateDialog } from "@/components/UpdateDialog";
import { useSettings } from "@/hooks/session";
import { api } from "@/lib/api";
import type { UpdateCheck } from "@/lib/types";

const SIX_HOURS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY = 4000; // laisse l'interface s'afficher avant d'interroger GitHub

interface UpdatesContextValue {
  check: UpdateCheck | undefined;
  /** Nouvelle version disponible et non ignorée par l'utilisateur. */
  pending: UpdateCheck["latest"];
  checking: boolean;
  checkNow: () => Promise<UpdateCheck>;
  showDialog: () => void;
}

const UpdatesContext = createContext<UpdatesContextValue | null>(null);

/**
 * Vérifie au démarrage puis toutes les 6 heures si une version plus récente est publiée
 * (API « latest release » de GitHub, via le moteur Python). Affiche une fenêtre une seule fois
 * par version et par session ; « Ignorer cette version » la fait taire définitivement.
 */
export function UpdatesProvider({ children }: { children: ReactNode }) {
  const { settings, update } = useSettings();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), STARTUP_DELAY);
    return () => clearTimeout(timer);
  }, []);

  const query = useQuery({
    queryKey: ["update-check"],
    queryFn: () => api.checkForUpdate(false),
    enabled: ready && settings?.check_updates !== false && settings !== undefined,
    staleTime: SIX_HOURS,
    refetchInterval: SIX_HOURS,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const check = query.data;
  const pending = check?.available && check.latest && check.latest.version !== settings?.dismissed_update_version ? check.latest : null;

  // Fenêtre automatique : une fois par version pendant la session.
  useEffect(() => {
    if (pending && shownFor !== pending.version) {
      setShownFor(pending.version);
      setOpen(true);
    }
  }, [pending, shownFor]);

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      const result = await api.checkForUpdate(true);
      queryClient.setQueryData(["update-check"], result);
      return result;
    } finally {
      setChecking(false);
    }
  }, [queryClient]);

  const value = useMemo<UpdatesContextValue>(
    () => ({ check, pending, checking, checkNow, showDialog: () => setOpen(true) }),
    [check, pending, checking, checkNow],
  );

  return (
    <UpdatesContext.Provider value={value}>
      {children}
      {check?.latest ? (
        <UpdateDialog
          open={open}
          onOpenChange={setOpen}
          check={check}
          onSkip={() => {
            update({ dismissed_update_version: check.latest!.version });
            setOpen(false);
          }}
        />
      ) : null}
    </UpdatesContext.Provider>
  );
}

export function useUpdates() {
  const context = useContext(UpdatesContext);
  if (!context) throw new Error("useUpdates doit être utilisé dans <UpdatesProvider>");
  return context;
}
