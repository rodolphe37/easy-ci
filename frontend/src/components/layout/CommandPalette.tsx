import { Command } from "cmdk";
import { BookOpen, FolderGit2, LayoutDashboard, LogOut, Monitor, Moon, Plus, RefreshCw, Settings, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { StatusIcon, STATE_LABELS } from "@/components/status";
import { Kbd } from "@/components/ui/primitives";
import { useScans } from "@/hooks/scans";
import { useSession, useSessionActions, useSettings } from "@/hooks/session";
import { ProviderIcon, repoPath } from "@/lib/providers";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { entries, refreshAll } = useScans();
  const { data: session } = useSession();
  const { update } = useSettings();
  const { logout } = useSessionActions();

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  // Les dépôts avec CI d'abord, puis les autres.
  const sorted = [...entries].sort((a, b) => Number(b.scan?.has_ci ?? false) - Number(a.scan?.has_ci ?? false));

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Palette de commandes"
      overlayClassName="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-fade-in"
      contentClassName="fixed top-[14%] left-1/2 z-50 w-[min(640px,calc(100vw-48px))] -translate-x-1/2 overflow-hidden rounded-2xl bg-elevated shadow-pop animate-pop-in"
    >
      <Command.Input
        placeholder="Rechercher un dépôt, une page, une action…"
        className="h-13 w-full border-b border-line bg-transparent px-4 text-[14.5px] text-fg outline-none placeholder:text-fg-subtle"
      />
      <Command.List className="scrollbar-thin max-h-[min(420px,60vh)] overflow-y-auto p-2">
        <Command.Empty className="py-10 text-center text-[13px] text-fg-muted">Aucun résultat.</Command.Empty>

        <Group heading="Dépôts">
          {sorted.map(({ repo, scan }) => (
            <Item
              key={repo.key}
              value={`repo ${repo.provider} ${repo.full_name}`}
              onSelect={() => run(() => navigate(repoPath(repo.provider, repo.full_name)))}
              icon={<StatusIcon state={scan?.state ?? "none"} />}
              hint={scan ? STATE_LABELS[scan.state] : undefined}
            >
              <ProviderIcon provider={repo.provider} className="mr-1.5 inline size-3.5 align-[-2px]" />
              <span className="text-fg-muted">{repo.owner}/</span>
              <span className="font-medium">{repo.name}</span>
            </Item>
          ))}
        </Group>

        <Group heading="Navigation">
          <Item value="vue d'ensemble dashboard" icon={<LayoutDashboard />} onSelect={() => run(() => navigate("/"))}>
            Vue d'ensemble
          </Item>
          <Item value="dépôts repositories" icon={<FolderGit2 />} onSelect={() => run(() => navigate("/repos"))}>
            Dépôts
          </Item>
          <Item value="paramètres settings" icon={<Settings />} onSelect={() => run(() => navigate("/settings"))}>
            Paramètres
          </Item>
          <Item value="documentation aide guide help token" icon={<BookOpen />} onSelect={() => run(() => navigate("/docs"))}>
            Documentation
          </Item>
        </Group>

        <Group heading="Actions">
          <Item value="ajouter un dépôt add repository" icon={<Plus />} onSelect={() => run(() => navigate("/settings#repositories"))}>
            Ajouter un dépôt
          </Item>
          <Item value="connecter un compte gitlab bitbucket github" icon={<Plus />} onSelect={() => run(() => navigate("/settings"))}>
            Connecter un compte
          </Item>
          <Item value="actualiser rafraîchir refresh" icon={<RefreshCw />} onSelect={() => run(() => void refreshAll())} shortcut="R">
            Tout actualiser
          </Item>
          <Item value="thème clair light" icon={<Sun />} onSelect={() => run(() => update({ theme: "light" }))}>
            Thème clair
          </Item>
          <Item value="thème sombre dark" icon={<Moon />} onSelect={() => run(() => update({ theme: "dark" }))}>
            Thème sombre
          </Item>
          <Item value="thème système auto" icon={<Monitor />} onSelect={() => run(() => update({ theme: "system" }))}>
            Thème du système
          </Item>
          <Item value="déconnexion logout quitter démo" icon={<LogOut />} onSelect={() => run(() => logout.mutate())}>
            {session?.mode === "demo" ? "Quitter la démo" : "Déconnecter tous les comptes"}
          </Item>
        </Group>
      </Command.List>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11.5px] text-fg-subtle">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> naviguer
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> ouvrir
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd> fermer
        </span>
      </div>
    </Command.Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-subtle [&_[cmdk-group-heading]]:uppercase"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  children,
  icon,
  hint,
  shortcut,
  value,
  onSelect,
}: {
  children: ReactNode;
  icon: ReactNode;
  hint?: string;
  shortcut?: string;
  value: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-fg data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&>svg]:text-fg-subtle"
    >
      {icon}
      <span className="truncate">{children}</span>
      {hint ? <span className="ml-auto text-[12px] text-fg-subtle">{hint}</span> : null}
      {shortcut ? <Kbd className="ml-auto">{shortcut}</Kbd> : null}
    </Command.Item>
  );
}
