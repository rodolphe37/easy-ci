import { useQuery } from "@tanstack/react-query";
import { BookOpen, FolderGit2, LayoutDashboard, RefreshCw, Search, Settings as SettingsIcon, Sparkles, Star } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useMatches } from "react-router";
import { StatusIcon } from "@/components/status";
import { Avatar, Badge, Button, Kbd, Logo } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/overlays";
import { useNow } from "@/hooks/useNow";
import { useAutoFetch } from "@/hooks/local";
import { useScans } from "@/hooks/scans";
import { useSession, useSessionActions, useSettings } from "@/hooks/session";
import { api } from "@/lib/api";
import { PROVIDER_LABELS, ProviderIcon, repoPath } from "@/lib/providers";
import { cn, formatNumber, timeAgo } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";

export interface RouteHandle {
  crumb?: (params: Record<string, string | undefined>) => { label: string; to?: string }[];
}

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  useAutoFetch();
  const location = useLocation();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar onSearch={() => setPaletteOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onSearch={() => setPaletteOpen(true)} />
        <main key={location.pathname} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Sidebar({ onSearch }: { onSearch: () => void }) {
  const { data: session } = useSession();
  const { settings } = useSettings();
  const { entries, byKey } = useScans();
  const failing = entries.filter((e) => e.scan?.state === "failure").length;
  const favorites = (settings?.favorites ?? []).flatMap((key) => {
    const entry = byKey.get(key);
    return entry ? [entry] : [];
  });

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface/60">
      <div className="flex h-13 items-center gap-2.5 px-4">
        <Logo />
        <span className="text-[14.5px] font-semibold tracking-tight">Easy CI</span>
        {session?.mode === "demo" ? <Badge className="ml-auto border-accent/25 bg-accent-soft text-accent">Démo</Badge> : null}
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={onSearch}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-fg-subtle transition-colors hover:border-line-strong hover:text-fg-muted"
        >
          <Search className="size-3.5" />
          <span>Rechercher…</span>
          <span className="ml-auto flex gap-0.5">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 py-2">
        <SidebarLink to="/" icon={<LayoutDashboard />} end>
          Vue d'ensemble
        </SidebarLink>
        <SidebarLink to="/repos" icon={<FolderGit2 />} count={failing || undefined}>
          Dépôts
        </SidebarLink>
        <SidebarLink to="/settings" icon={<SettingsIcon />}>
          Paramètres
        </SidebarLink>
        <SidebarLink to="/docs" icon={<BookOpen />}>
          Documentation
        </SidebarLink>
      </nav>

      <div className="mt-3 flex min-h-0 flex-1 flex-col px-3">
        <div className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
          <Star className="size-3" /> Favoris
        </div>
        <div className="scrollbar-thin -mx-1 flex-1 overflow-y-auto px-1">
          {favorites.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] leading-relaxed text-fg-subtle">
              Ajoutez des dépôts en favoris avec l'étoile pour les retrouver ici.
            </p>
          ) : (
            favorites.map((entry) => (
              <NavLink
                key={entry.repo.key}
                to={repoPath(entry.repo.provider, entry.repo.full_name)}
                className={({ isActive }) =>
                  cn(
                    "flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
                    isActive ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
                  )
                }
              >
                <StatusIcon state={entry.scan?.state ?? "none"} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{entry.repo.name}</span>
                <ProviderIcon provider={entry.repo.provider} className="size-3 shrink-0 opacity-70" mono />
              </NavLink>
            ))
          )}
        </div>
      </div>

      <SidebarFooter />
    </aside>
  );
}

function SidebarLink({ to, icon, children, end, count }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean; count?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13.5px] font-medium transition-colors [&_svg]:size-4",
          isActive ? "bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--line)]" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={cn("transition-colors", isActive ? "text-accent" : "text-fg-subtle group-hover:text-fg-muted")}>{icon}</span>
          {children}
          {count ? (
            <Tooltip content={`${count} dépôt${count > 1 ? "s" : ""} en échec`}>
              <span className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-failure px-1 text-[10.5px] font-semibold text-white">
                {count}
              </span>
            </Tooltip>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

function SidebarFooter() {
  const { data: session } = useSession();
  const { data: rates } = useQuery({
    queryKey: ["rate-limits"],
    queryFn: api.getRateLimits,
    refetchInterval: 20_000,
    enabled: session?.mode === "live",
  });
  const accounts = session?.accounts ?? [];

  return (
    <div className="border-t border-line p-3">
      {(rates ?? []).map((rate) => {
        const ratio = rate.limit ? rate.remaining / rate.limit : 1;
        const label = PROVIDER_LABELS[rate.provider].label;
        return (
          <Tooltip
            key={rate.provider}
            content={`Quota API ${label} : ${formatNumber(rate.remaining)} requêtes restantes${rate.reset_at ? `, réinitialisé ${timeAgo(new Date(rate.reset_at * 1000).toISOString())}` : ""}`}
          >
            <div className="mb-2.5 px-1">
              <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
                <span className="inline-flex items-center gap-1">
                  <ProviderIcon provider={rate.provider} className="size-3" mono /> Quota {label}
                </span>
                <span className="tabular">
                  {formatNumber(rate.remaining)} / {formatNumber(rate.limit)}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className={cn("h-full rounded-full transition-[width] duration-500", ratio < 0.1 ? "bg-failure" : ratio < 0.3 ? "bg-running" : "bg-accent")}
                  style={{ width: `${Math.max(2, ratio * 100)}%` }}
                />
              </div>
            </div>
          </Tooltip>
        );
      })}
      <Link to="/settings" className="flex items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-surface-2">
        <Avatar login={session?.user?.login} src={session?.user?.avatar_url} size={28} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-medium">{session?.user?.name}</div>
          <div className="truncate text-[11.5px] text-fg-subtle">
            {session?.mode === "demo" ? "Mode démo" : `${accounts.length} compte${accounts.length > 1 ? "s" : ""} connecté${accounts.length > 1 ? "s" : ""}`}
          </div>
        </div>
        <div className="flex -space-x-1">
          {accounts.map((account) => (
            <Tooltip key={account.provider} content={`${PROVIDER_LABELS[account.provider].label} · @${account.user.login}`}>
              <span className="flex size-5 items-center justify-center rounded-full bg-surface ring-2 ring-canvas">
                <ProviderIcon provider={account.provider} className="size-3" />
              </span>
            </Tooltip>
          ))}
        </div>
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Topbar({ onSearch }: { onSearch: () => void }) {
  const matches = useMatches();
  const { isRefreshing, refreshAll, lastUpdatedAt, scanned, total } = useScans();
  const { data: session } = useSession();
  const { logout } = useSessionActions();
  const now = useNow();
  const crumbs = matches.flatMap((match) => (match.handle as RouteHandle | undefined)?.crumb?.(match.params) ?? []);
  const scanning = total > 0 && scanned < total;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "r") void refreshAll();
      if (event.key === "/") {
        event.preventDefault();
        // Priorité au champ de recherche de la page courante, sinon la palette.
        const pageSearch = document.querySelector<HTMLInputElement>("[data-page-search]");
        if (pageSearch) pageSearch.focus();
        else onSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshAll, onSearch]);

  return (
    <header className="relative flex h-13 shrink-0 items-center gap-3 border-b border-line bg-canvas/80 px-6 backdrop-blur">
      <nav className="flex min-w-0 items-center gap-1.5 text-[13.5px]" aria-label="Fil d'Ariane">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <span key={index} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? <span className="text-fg-subtle">/</span> : null}
              {crumb.to && !last ? (
                <Link to={crumb.to} className="truncate text-fg-muted transition-colors hover:text-fg">
                  {crumb.label}
                </Link>
              ) : (
                <span className={cn("truncate", last ? "font-semibold text-fg" : "text-fg-muted")}>{crumb.label}</span>
              )}
            </span>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {session?.mode === "demo" ? (
          <div className="mr-2 flex items-center gap-2 rounded-full border border-accent/25 bg-accent-soft py-1 pr-1 pl-3 text-[12.5px]">
            <Sparkles className="size-3.5 text-accent" />
            <span className="hidden font-medium text-fg lg:inline">Mode démo : données fictives</span>
            <Button variant="primary" size="sm" className="h-6.5 rounded-full px-3" onClick={() => logout.mutate()} loading={logout.isPending}>
              Connecter un compte
            </Button>
          </div>
        ) : null}
        <span className="hidden items-center gap-2 text-[12px] text-fg-subtle md:flex">
          {scanning ? (
            <span className="tabular">
              Analyse des dépôts… {scanned}/{total}
            </span>
          ) : lastUpdatedAt ? (
            <>
              <span className="size-1.5 rounded-full bg-success" />
              <span>Actualisé {timeAgo(new Date(lastUpdatedAt).toISOString(), now)}</span>
            </>
          ) : null}
        </span>
        <Tooltip content={<span className="flex items-center gap-2">Tout actualiser <Kbd>R</Kbd></span>}>
          <Button variant="ghost" size="icon" onClick={() => void refreshAll()} aria-label="Tout actualiser">
            <RefreshCw className={cn(isRefreshing && "animate-spin")} />
          </Button>
        </Tooltip>
      </div>

      {scanning ? (
        <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${(scanned / total) * 100}%` }} />
        </div>
      ) : null}
    </header>
  );
}
