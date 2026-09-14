import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import i18n, { applyLanguagePreference } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { PROVIDER_LABELS } from "@/lib/providers";
import type { ProviderId, ProviderInfo, Session, Settings } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: api.getSession, staleTime: Number.POSITIVE_INFINITY, retry: false });
}

/** Capacités et libellés d'un fournisseur (issus du moteur). */
export function useProviderInfo(provider: ProviderId): ProviderInfo | undefined {
  return useSession().data?.providers[provider];
}

export function useSessionActions() {
  const queryClient = useQueryClient();
  const apply = useCallback(
    (session: Session) => {
      const previous = queryClient.getQueryData<Session>(["session"]);
      if (previous?.mode !== session.mode) {
        // Passage démo ↔ comptes réels : on repart d'un cache propre.
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" && query.queryKey[0] !== "settings" });
      }
      queryClient.setQueryData(["session"], session);
    },
    [queryClient],
  );

  const connect = useMutation({
    mutationFn: ({ provider, credentials }: { provider: ProviderId; credentials: Record<string, string> }) => api.connectAccount(provider, credentials),
    onSuccess: (session, { provider }) => {
      apply(session);
      void queryClient.invalidateQueries({ queryKey: ["repositories", provider] });
      const account = session.accounts.find((a) => a.provider === provider);
      toast.success(i18n.t("session.connected", { provider: PROVIDER_LABELS[provider].label }), { description: account ? i18n.t("session.account", { login: account.user.login }) : undefined });
    },
  });
  const loginWithGhCli = useMutation({ mutationFn: api.loginWithGhCli, onSuccess: apply });
  const startDemo = useMutation({ mutationFn: api.startDemo, onSuccess: apply });
  const disconnect = useMutation({
    mutationFn: api.disconnectAccount,
    onSuccess: (session, provider) => {
      apply(session);
      queryClient.removeQueries({ queryKey: ["repositories", provider] });
      queryClient.removeQueries({ predicate: (query) => typeof query.queryKey[1] === "string" && query.queryKey[1].startsWith(`${provider}:`) });
      toast(i18n.t("session.disconnected", { provider: PROVIDER_LABELS[provider].label }), { description: i18n.t("session.credentialsRemoved") });
    },
  });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: (session) => {
      const previousMode = queryClient.getQueryData<Session>(["session"])?.mode;
      apply(session);
      if (previousMode === "live") toast(i18n.t("session.loggedOut"), { description: i18n.t("session.credentialsRemoved") });
    },
  });
  return { connect, loginWithGhCli, startDemo, disconnect, logout };
}

/* -------------------------------------------------------------------------- */
/* Préférences & thème                                                        */
/* -------------------------------------------------------------------------- */

const THEME_KEY = "easy-ci-theme";

interface SettingsContextValue {
  settings: Settings | undefined;
  update: (changes: Partial<Settings>) => void;
  resolvedTheme: "light" | "dark";
  toggleFavorite: (fullName: string) => void;
  isFavorite: (fullName: string) => boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings, staleTime: Number.POSITIVE_INFINITY });

  const mutation = useMutation({
    mutationFn: api.updateSettings,
    onMutate: async (changes) => {
      const previous = queryClient.getQueryData<Settings>(["settings"]);
      if (previous) queryClient.setQueryData(["settings"], { ...previous, ...changes });
      return { previous };
    },
    onError: (error, _changes, context) => {
      if (context?.previous) queryClient.setQueryData(["settings"], context.previous);
      toast.error(i18n.t("session.settingsNotSaved"), { description: error instanceof ApiError ? error.message : String(error) });
    },
    onSuccess: (saved) => queryClient.setQueryData(["settings"], saved),
  });

  // Langue : préférence enregistrée (ou langue du système), puis actualisation des textes produits par le moteur.
  useEffect(() => {
    if (settings) applyLanguagePreference(settings.language);
  }, [settings?.language]);

  useEffect(() => {
    const onChange = (language: string) => {
      document.documentElement.lang = language;
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "settings" });
    };
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
    i18n.on("languageChanged", onChange);
    return () => i18n.off("languageChanged", onChange);
  }, [queryClient]);

  const theme = settings?.theme ?? readStoredTheme();
  const resolvedTheme: "light" | "dark" = theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;

  useEffect(() => {
    const apply = () => {
      const next = theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = next;
    };
    apply();
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* stockage indisponible : le thème sera simplement relu depuis Python */
    }
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const value = useMemo<SettingsContextValue>(() => {
    const favorites = settings?.favorites ?? [];
    return {
      settings,
      update: (changes) => mutation.mutate(changes),
      resolvedTheme,
      isFavorite: (fullName) => favorites.includes(fullName),
      toggleFavorite: (fullName) =>
        mutation.mutate({
          favorites: favorites.includes(fullName) ? favorites.filter((f) => f !== fullName) : [...favorites, fullName],
        }),
    };
  }, [settings, resolvedTheme]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

function readStoredTheme(): Settings["theme"] {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used within <SettingsProvider>");
  return context;
}
