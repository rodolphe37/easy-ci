import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  ChevronRight,
  Code2,
  Download,
  FileCode2,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Info,
  Laptop,
  Link2,
  MoreHorizontal,
  RefreshCw,
  SquareTerminal,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { errorMessage, useLocalActions, useLocalProjects, useLocalStatus } from "@/hooks/local";
import { useSettings } from "@/hooks/session";
import { useNow } from "@/hooks/useNow";
import { api, ApiError } from "@/lib/api";
import { PROVIDER_LABELS } from "@/lib/providers";
import type { CiFileState, LocalStatus, Repository } from "@/lib/types";
import { cn, shortSha, timeAgo } from "@/lib/utils";
import { TimeAgo } from "../runs";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from "../ui/overlays";
import { Badge, Button, buttonClass, Card, EmptyState, SegmentedControl, Skeleton, Spinner } from "../ui/primitives";
import { DiffViewer } from "./DiffViewer";
import { FolderField } from "./FolderField";

type LinkedStatus = Extract<LocalStatus, { linked: true }>;

export const CI_STATE_INFO: Record<CiFileState, { label: string; description: string; tone: "success" | "running" | "accent" | "failure" | "muted" }> = {
  synced: { label: "Synchronisé", description: "Identique à la branche distante.", tone: "success" },
  uncommitted: { label: "Modifié localement", description: "Modification en cours, pas encore commitée.", tone: "running" },
  untracked: { label: "Nouveau, non suivi", description: "Fichier créé localement, jamais commité.", tone: "running" },
  unpushed: { label: "Commité, non poussé", description: "Commit local pas encore envoyé sur la branche distante.", tone: "accent" },
  outdated: { label: "En retard", description: "La branche distante contient une version plus récente : mettez à jour.", tone: "running" },
  diverged: { label: "Divergé", description: "Modifié à la fois localement et sur la branche distante.", tone: "failure" },
};

const TONES = {
  success: "border-success/25 bg-success/10 text-fg",
  running: "border-running/30 bg-running/10 text-fg",
  accent: "border-accent/25 bg-accent-soft text-fg",
  failure: "border-failure/30 bg-failure/10 text-fg",
  muted: "",
};
const DOTS = { success: "bg-success", running: "bg-running", accent: "bg-accent", failure: "bg-failure", muted: "bg-fg-subtle" };

export function CiStateBadge({ state }: { state: CiFileState }) {
  const info = CI_STATE_INFO[state];
  return (
    <Tooltip content={info.description}>
      <Badge className={cn("gap-1.5", TONES[info.tone])}>
        <span className={cn("size-1.5 rounded-full", DOTS[info.tone])} />
        {info.label}
      </Badge>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------------- */

export function LocalProjectPanel({ repo }: { repo: Repository }) {
  const statusQuery = useLocalStatus(repo.key);
  const status = statusQuery.data;

  if (statusQuery.isPending) {
    return (
      <Card className="p-5">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="mt-3 h-4 w-2/3" />
        <Skeleton className="mt-6 h-32 w-full" />
      </Card>
    );
  }
  if (statusQuery.error) {
    return (
      <Card>
        <EmptyState icon={<TriangleAlert />} title="État local indisponible" description={errorMessage(statusQuery.error)} />
      </Card>
    );
  }
  if (!status?.linked) return <NotLinked repo={repo} />;
  return <Linked repo={repo} status={status} refreshing={statusQuery.isFetching} onRefresh={() => void statusQuery.refetch()} />;
}

/* -------------------------------------------------------------------------- */
/* Dépôt sans dossier local                                                    */
/* -------------------------------------------------------------------------- */

function NotLinked({ repo }: { repo: Repository }) {
  const { overview } = useLocalProjects();
  const [mode, setMode] = useState<"link" | "clone">("link");
  const noRoots = overview && overview.roots.length === 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="p-5">
        <div className="flex items-start gap-3.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Laptop className="size-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold">Aucun dossier local lié</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
              Reliez ce dépôt à son clone sur votre machine. Easy CI y suivra la branche, les commits à récupérer ou à pousser, et l'état des fichiers CI. Les
              modifications de pipelines seront faites dans ce dossier.
            </p>
          </div>
        </div>

        {overview?.git_version === null ? (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-failure/30 bg-failure/[0.06] p-3.5 text-[13px] text-fg-muted">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-failure" />
            Git n'est pas installé sur cette machine (ou n'est pas dans le PATH). Installez-le puis relancez Easy CI.
          </div>
        ) : null}

        <SegmentedControl<"link" | "clone">
          value={mode}
          onChange={setMode}
          className="mt-5"
          options={[
            { value: "link", label: <><Link2 />Lier un dossier existant</> },
            { value: "clone", label: <><Download />Cloner le dépôt</> },
          ]}
        />
        <div className="mt-4">{mode === "link" ? <LinkForm repo={repo} pickerAvailable={overview?.picker_available ?? false} /> : <CloneForm repo={repo} pickerAvailable={overview?.picker_available ?? false} defaultParent={overview?.roots[0]?.path ?? ""} />}</div>
      </Card>

      <Card className="p-5 text-[13px] leading-relaxed text-fg-muted">
        <div className="mb-2 flex items-center gap-2 font-semibold text-fg">
          <FolderGit2 className="size-4 text-accent" /> Détection automatique
        </div>
        {noRoots ? (
          <p>
            Indiquez le dossier où se trouvent vos projets (par exemple <code className="font-mono text-[12px] text-fg">~/Developer</code>) : Easy CI y repérera tous
            vos clones et les reliera automatiquement à leurs dépôts.
          </p>
        ) : (
          <p>
            Easy CI parcourt {overview?.roots.length === 1 ? "le dossier" : "les dossiers"}{" "}
            {overview?.roots.map((root, index) => (
              <span key={root.path}>
                <code className="font-mono text-[12px] text-fg">{root.display_path}</code>
                {index < overview.roots.length - 1 ? ", " : ""}
              </span>
            ))}{" "}
            sans y trouver de clone de ce dépôt. Clonez-le, ou liez un dossier situé ailleurs.
          </p>
        )}
        <Link to="/settings#local" className={buttonClass("secondary", "sm", "mt-3")}>
          {noRoots ? "Ajouter un dossier de projets" : "Gérer les dossiers"} <ChevronRight className="size-3.5" />
        </Link>
      </Card>
    </div>
  );
}

function LinkForm({ repo, pickerAvailable }: { repo: Repository; pickerAvailable: boolean }) {
  const [path, setPath] = useState("");
  const { link } = useLocalActions();
  const mismatch = link.error instanceof ApiError && link.error.code === "link_mismatch" ? link.error.message : null;

  const submit = (event: FormEvent, force = false) => {
    event.preventDefault();
    if (path.trim()) link.mutate({ key: repo.key, path: path.trim(), force });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="link-path" className="block text-[12.5px] font-medium text-fg-muted">
        Dossier du clone local
      </label>
      <FolderField
        id="link-path"
        value={path}
        onChange={(value) => {
          setPath(value);
          link.reset();
        }}
        pickerAvailable={pickerAvailable}
        pickerTitle={`Dossier local de ${repo.full_name}`}
        placeholder={`~/Developer/${repo.name}`}
      />
      {mismatch ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-running/30 bg-running/[0.07] p-3 text-[12.5px] text-fg-muted animate-fade-in">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-running" />
          <div className="flex-1">
            {mismatch} Vérifiez le dossier choisi.
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={(event) => submit(event, true)} loading={link.isPending}>
                Lier quand même
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <Button type="submit" variant="primary" loading={link.isPending && !mismatch} disabled={!path.trim()}>
        <Link2 /> Lier ce dossier
      </Button>
    </form>
  );
}

function CloneForm({ repo, pickerAvailable, defaultParent }: { repo: Repository; pickerAvailable: boolean; defaultParent: string }) {
  const [parent, setParent] = useState(defaultParent);
  const [protocol, setProtocol] = useState<"https" | "ssh">("https");
  const { clone } = useLocalActions();
  const destination = parent.trim() ? `${parent.trim().replace(/\/+$/, "")}/${repo.name}` : null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (parent.trim()) clone.mutate({ key: repo.key, parent: parent.trim(), protocol });
      }}
      className="space-y-3"
    >
      <label htmlFor="clone-parent" className="block text-[12.5px] font-medium text-fg-muted">
        Cloner dans le dossier
      </label>
      <FolderField id="clone-parent" value={parent} onChange={setParent} pickerAvailable={pickerAvailable} pickerTitle="Dossier où cloner le dépôt" />
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<"https" | "ssh">
          value={protocol}
          onChange={setProtocol}
          options={[
            { value: "https", label: "HTTPS" },
            { value: "ssh", label: "SSH" },
          ]}
        />
        <span className="text-[12px] text-fg-subtle">
          {protocol === "https" ? "Utilise le gestionnaire d'identifiants de Git." : "Utilise votre clé SSH."}
        </span>
      </div>
      {destination ? (
        <p className="text-[12.5px] text-fg-muted">
          Destination : <code className="font-mono text-[12px] text-fg">{destination}</code>
        </p>
      ) : null}
      <Button type="submit" variant="primary" loading={clone.isPending} disabled={!parent.trim()}>
        <Download /> {clone.isPending ? "Clonage en cours…" : `Cloner ${repo.name}`}
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Dépôt lié                                                                   */
/* -------------------------------------------------------------------------- */

function Linked({ repo, status, refreshing, onRefresh }: { repo: Repository; status: LinkedStatus; refreshing: boolean; onRefresh: () => void }) {
  const { overview } = useLocalProjects();
  const { settings } = useSettings();
  const { sync, unlink, open } = useLocalActions();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const now = useNow();

  if (!status.exists || status.error) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-running" />
          <div className="flex-1">
            <div className="text-[14px] font-semibold">{status.error}</div>
            <code className="mt-1 block font-mono text-[12.5px] text-fg-muted">{status.display_path}</code>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => unlink.mutate(repo.key)} loading={unlink.isPending}>
                <Unlink /> Délier et choisir un autre dossier
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;
  const ciFiles = status.ci_files ?? [];
  const otherChanges = (status.changes ?? []).filter((change) => !ciFiles.some((file) => file.path === change.path));
  const pullBlocked = !status.upstream ? "La branche locale ne suit aucune branche distante." : status.dirty ? "Des modifications locales ne sont pas commitées." : ahead > 0 && behind > 0 ? "Branches divergentes : fusionnez depuis votre terminal." : behind === 0 ? "Déjà à jour." : null;
  const editor = overview?.editors.find((e) => e.id === settings?.preferred_editor) ?? overview?.editors[0];
  const busy = sync.isPending;
  const providerLabel = PROVIDER_LABELS[repo.provider].label;

  return (
    <div className="space-y-5">
      {/* Carte d'état */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Laptop className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <code className="truncate font-mono text-[13.5px] font-medium text-fg">{status.display_path}</code>
              <Badge>{overview?.projects.find((p) => p.key === repo.key)?.source === "manual" ? "Lié manuellement" : "Détecté automatiquement"}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-fg-muted">
              <span className="inline-flex items-center gap-1.5">
                <GitBranch className="size-3.5 text-fg-subtle" />
                <span className="font-mono text-fg">{status.detached ? "HEAD détachée" : status.branch}</span>
                {status.upstream ? <span className="text-fg-subtle">→ {status.upstream}</span> : <span className="text-running">sans branche distante</span>}
              </span>
              {status.last_commit ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <GitCommitHorizontal className="size-3.5 shrink-0 text-fg-subtle" />
                  <span className="font-mono text-[12px]">{shortSha(status.last_commit.sha)}</span>
                  <span className="max-w-72 truncate">{status.last_commit.message}</span>
                  <TimeAgo date={status.last_commit.date} className="text-fg-subtle" />
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Tooltip content="Interroge le serveur Git sans modifier votre copie de travail (git fetch).">
              <Button onClick={() => sync.mutate({ key: repo.key, pull: false })} loading={busy && sync.variables?.pull === false}>
                <RefreshCw /> Récupérer
              </Button>
            </Tooltip>
            <Tooltip content={pullBlocked ?? `Met à jour la branche en avance rapide (${behind} commit${behind > 1 ? "s" : ""}).`}>
              <span>
                <Button
                  variant={behind > 0 && !pullBlocked ? "primary" : "secondary"}
                  onClick={() => sync.mutate({ key: repo.key, pull: true })}
                  loading={busy && sync.variables?.pull === true}
                  disabled={Boolean(pullBlocked)}
                >
                  <ArrowDownToLine /> Mettre à jour
                </Button>
              </span>
            </Tooltip>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label="Plus d'actions">
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<FolderOpen />} onSelect={() => open.mutate({ key: repo.key, target: "folder" })}>
                  Afficher dans {overview?.file_manager ?? "le Finder"}
                </MenuItem>
                <MenuItem
                  icon={<Code2 />}
                  disabled={!editor}
                  description={editor ? undefined : "Aucun éditeur reconnu"}
                  onSelect={() => open.mutate({ key: repo.key, target: "editor", editorId: editor?.id })}
                >
                  Ouvrir dans {editor?.label ?? "l'éditeur"}
                </MenuItem>
                <MenuItem icon={<SquareTerminal />} onSelect={() => open.mutate({ key: repo.key, target: "terminal" })}>
                  Ouvrir un terminal
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<RefreshCw />} onSelect={onRefresh}>
                  Actualiser l'état
                </MenuItem>
                <MenuItem icon={<Unlink />} description="Le dossier n'est ni modifié ni supprimé" destructive onSelect={() => unlink.mutate(repo.key)}>
                  Délier ce dossier
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <Metric
            icon={<ArrowDown />}
            label="À récupérer"
            value={behind}
            tone={behind > 0 ? "running" : "muted"}
            hint={behind > 0 ? `commit${behind > 1 ? "s" : ""} sur ${status.upstream}` : "à jour"}
          />
          <Metric icon={<ArrowUp />} label="À pousser" value={ahead} tone={ahead > 0 ? "accent" : "muted"} hint={ahead > 0 ? `commit${ahead > 1 ? "s" : ""} local${ahead > 1 ? "aux" : ""}` : "rien en attente"} />
          <Metric
            icon={<FileCode2 />}
            label="Non commités"
            value={status.changes_count ?? 0}
            tone={status.dirty ? "running" : "muted"}
            hint={status.dirty ? "fichier(s) modifié(s)" : "copie de travail propre"}
          />
          <Metric
            icon={<RefreshCw className={cn(refreshing && "animate-spin")} />}
            label="Dernière récupération"
            text={status.last_fetch_at ? timeAgo(new Date(status.last_fetch_at * 1000).toISOString(), now) : "jamais"}
            tone="muted"
            hint={settings?.auto_fetch_minutes ? `automatique toutes les ${settings.auto_fetch_minutes} min` : "automatique désactivée"}
          />
        </div>

        {!status.remote_matches ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-running/30 bg-running/[0.07] p-3 text-[12.5px] text-fg-muted">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-running" />
            Aucun remote de ce dossier ne pointe vers {repo.full_name} sur {providerLabel} : les comparaisons se font avec {status.compare_ref ?? "aucune branche distante"}.
          </div>
        ) : null}
      </Card>

      {/* Fichiers CI */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <FileCode2 className="size-4 text-fg-subtle" />
          <h3 className="text-[13.5px] font-semibold">Fichiers CI locaux</h3>
          <span className="text-[12.5px] text-fg-subtle">comparés à {status.compare_ref ?? "—"}</span>
        </div>
        {ciFiles.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-fg-muted">
            Aucun fichier {PROVIDER_LABELS[repo.provider].config} dans ce dossier ni sur la branche distante.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {ciFiles.map((file) => {
              const expanded = selectedFile === file.path;
              const hasDiff = file.state !== "synced";
              return (
                <div key={file.path}>
                  <button
                    onClick={() => hasDiff && setSelectedFile(expanded ? null : file.path)}
                    className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors", hasDiff ? "hover:bg-surface-2/60" : "cursor-default")}
                  >
                    <ChevronRight className={cn("size-3.5 shrink-0 text-fg-subtle transition-transform", expanded && "rotate-90", !hasDiff && "opacity-0")} />
                    <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{file.path}</code>
                    {!file.local ? <span className="text-[12px] text-fg-subtle">absent localement</span> : null}
                    <CiStateBadge state={file.state} />
                  </button>
                  {expanded ? <CiFileDiff repoKey={repo.key} path={file.path} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {otherChanges.length ? (
        <Card className="overflow-hidden">
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[13.5px] font-semibold select-none [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 text-fg-subtle" />
              Autres modifications non commitées
              <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-medium text-fg-muted tabular">{otherChanges.length}</span>
            </summary>
            <ul className="divide-y divide-line border-t border-line">
              {otherChanges.slice(0, 50).map((change) => (
                <li key={change.path} className="flex items-center gap-3 px-4 py-1.5 text-[12.5px]">
                  <code className="min-w-0 flex-1 truncate font-mono">{change.path}</code>
                  <span className="text-fg-subtle">{CHANGE_LABELS[change.status] ?? change.status}</span>
                </li>
              ))}
            </ul>
          </details>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2/50 p-3.5 text-[12.5px] leading-relaxed text-fg-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <p>
          Easy CI ne pousse jamais rien sans votre accord. Les modifications de pipelines (prochaine version) seront écrites dans ce dossier et commitées sur une
          branche locale ; l'envoi et la pull request se feront sur un bouton séparé. La mise à jour automatique, si vous l'activez, n'avance la branche que si
          aucune modification locale n'est en cours.
        </p>
      </div>
    </div>
  );
}

const CHANGE_LABELS: Record<string, string> = {
  modified: "modifié",
  added: "ajouté",
  deleted: "supprimé",
  renamed: "renommé",
  copied: "copié",
  untracked: "non suivi",
  conflict: "en conflit",
};

function Metric({ icon, label, value, text, hint, tone }: { icon: ReactNode; label: string; value?: number; text?: string; hint: string; tone: "running" | "accent" | "muted" }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3.5 py-3",
        tone === "running" ? "border-running/30 bg-running/[0.06]" : tone === "accent" ? "border-accent/25 bg-accent-soft/50" : "border-line bg-surface-2/40",
      )}
    >
      <div className="flex items-center gap-1.5 text-[12px] text-fg-muted [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-[20px] leading-tight font-semibold tracking-tight">{text ?? value}</div>
      <div className="truncate text-[11.5px] text-fg-subtle">{hint}</div>
    </div>
  );
}

function CiFileDiff({ repoKey, path }: { repoKey: string; path: string }) {
  const query = useQuery({ queryKey: ["local-diff", repoKey, path], queryFn: () => api.getLocalCiDiff(repoKey, path) });
  return (
    <div className="border-t border-line bg-surface-2/30 px-4 py-3 animate-fade-in">
      {query.isPending ? (
        <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">
          <Spinner className="size-3.5" /> Comparaison…
        </div>
      ) : query.error ? (
        <p className="text-[12.5px] text-failure">{errorMessage(query.error)}</p>
      ) : query.data?.diff ? (
        <DiffViewer diff={query.data.diff} />
      ) : (
        <p className="flex items-center gap-2 text-[12.5px] text-fg-muted">
          <Check className="size-3.5 text-success" /> Aucune différence de contenu avec {query.data?.compare_ref}.
        </p>
      )}
    </div>
  );
}
