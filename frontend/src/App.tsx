import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useEffect, useMemo } from "react";
import { createHashRouter, Navigate, RouterProvider, useNavigate, useRouteError } from "react-router";
import { Toaster } from "sonner";
import { AppShell, type RouteHandle } from "@/components/layout/AppShell";
import { TooltipProvider } from "@/components/ui/overlays";
import { Button, Logo, Spinner } from "@/components/ui/primitives";
import { ScanProvider } from "@/hooks/scans";
import { SettingsProvider, useSession, useSettings } from "@/hooks/session";
import { UpdatesProvider } from "@/hooks/updates";
import { ApiError } from "@/lib/api";
import { repoPath } from "@/lib/providers";
import type { ProviderId } from "@/lib/types";
import { ConnectPage } from "@/pages/ConnectPage";
import { DocsPage } from "@/pages/DocsPage";
import { EditorPage } from "@/pages/EditorPage";
import { GeneratePage } from "@/pages/GeneratePage";
import { OverviewPage } from "@/pages/OverviewPage";
import { RepoPage } from "@/pages/RepoPage";
import { ReposPage } from "@/pages/ReposPage";
import { RunPage } from "@/pages/RunPage";
import { SettingsPage } from "@/pages/SettingsPage";

const repoCrumbs: NonNullable<RouteHandle["crumb"]> = (params) => [
  { label: "Dépôts", to: "/repos" },
  { label: params.repo ?? "", to: repoPath((params.provider ?? "github") as ProviderId, params.repo ?? "") },
];

function createRouter() {
  return createHashRouter([
    {
      element: <AppShell />,
      errorElement: <RouteError />,
      children: [
        { index: true, element: <OverviewPage />, handle: { crumb: () => [{ label: "Vue d'ensemble" }] } satisfies RouteHandle },
        { path: "repos", element: <ReposPage />, handle: { crumb: () => [{ label: "Dépôts" }] } satisfies RouteHandle },
        { path: "repos/:provider/:repo", element: <RepoPage />, handle: { crumb: repoCrumbs } satisfies RouteHandle },
        {
          path: "repos/:provider/:repo/runs/:runId",
          element: <RunPage />,
          handle: { crumb: (params) => [...repoCrumbs(params), { label: `Exécution` }] } satisfies RouteHandle,
        },
        {
          path: "repos/:provider/:repo/edit",
          element: <EditorPage />,
          handle: { crumb: (params) => [...repoCrumbs(params), { label: "Modifier la CI" }] } satisfies RouteHandle,
        },
        {
          path: "repos/:provider/:repo/generate",
          element: <GeneratePage />,
          handle: { crumb: (params) => [...repoCrumbs(params), { label: "Générer un pipeline" }] } satisfies RouteHandle,
        },
        { path: "docs", element: <DocsPage />, handle: { crumb: () => [{ label: "Documentation" }] } satisfies RouteHandle },
        { path: "settings", element: <SettingsPage />, handle: { crumb: () => [{ label: "Paramètres" }] } satisfies RouteHandle },
        { path: "*", element: <Navigate to="/" replace /> },
      ],
    },
  ]);
}

export function App() {
  return (
    <SettingsProvider>
      <TooltipProvider delayDuration={350} skipDelayDuration={150}>
        <UpdatesProvider>
          <SessionGate />
        </UpdatesProvider>
        <ThemedToaster />
      </TooltipProvider>
    </SettingsProvider>
  );
}

function SessionGate() {
  const { data: session, isPending, error, refetch } = useSession();
  const queryClient = useQueryClient();

  // Si une plateforme rejette ses identifiants, le moteur déconnecte ce compte : on recharge la session.
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      const queryError = event.query.state.error;
      if (event.type === "updated" && queryError instanceof ApiError && queryError.code === "unauthorized" && event.query.queryKey[0] !== "session") {
        void queryClient.invalidateQueries({ queryKey: ["session"] });
      }
    });
  }, [queryClient]);

  if (isPending) return <Splash />;
  if (error) return <BackendError message={error.message} onRetry={() => void refetch()} />;
  if (!session?.authenticated) return <ConnectPage session={session} />;
  // Ajouter ou retirer un compte ne recrée pas l'application ; passer de la démo aux comptes réels, si.
  return <AuthenticatedApp key={session.mode} />;
}

function AuthenticatedApp() {
  const router = useMemo(createRouter, []);
  return (
    <ScanProvider>
      <RouterProvider router={router} />
    </ScanProvider>
  );
}

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 animate-fade-in">
      <Logo className="size-16 animate-pulse" />
      <div className="flex items-center gap-2 text-[13px] text-fg-subtle">
        <Spinner className="size-3.5" />
        Démarrage d'Easy CI…
      </div>
    </div>
  );
}

/** Erreur inattendue dans une page : message clair et moyen de repartir, sans écran technique. */
function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center animate-fade-in">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-failure/10 text-failure">
          <TriangleAlert className="size-5" />
        </div>
        <h1 className="text-[16px] font-semibold">Cette page a rencontré un problème</h1>
        <p className="mt-2 text-[13px] text-fg-muted">Rechargez la page ou revenez à la vue d'ensemble. Si le problème persiste, lancez l'app avec --debug.</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 text-left font-mono text-[11.5px] text-fg-subtle">{message}</pre>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>Recharger</Button>
          <Button variant="primary" onClick={() => navigate("/")}>
            Vue d'ensemble
          </Button>
        </div>
      </div>
    </div>
  );
}

function BackendError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center animate-fade-in">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-failure/10 text-failure">
          <TriangleAlert className="size-5" />
        </div>
        <h1 className="text-[16px] font-semibold">Impossible de démarrer</h1>
        <p className="mt-2 text-[13px] text-fg-muted">{message}</p>
        <Button className="mt-5" variant="primary" onClick={onRetry}>
          Réessayer
        </Button>
      </div>
    </div>
  );
}

function ThemedToaster() {
  const { resolvedTheme } = useSettings();
  return (
    <Toaster
      theme={resolvedTheme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border-line !bg-elevated !text-fg !shadow-pop !font-sans",
          description: "!text-fg-muted",
        },
      }}
    />
  );
}
