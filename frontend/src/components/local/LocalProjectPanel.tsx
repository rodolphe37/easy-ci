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
  FilePlus2,
  FolderGit2,
  Pencil,
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
  Zap,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Trans } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { errorMessage, useLocalActions, useLocalProjects, useLocalStatus } from "@/hooks/local";
import i18n from "@/i18n";
import { useSettings } from "@/hooks/session";
import { useNow } from "@/hooks/useNow";
import { api, ApiError } from "@/lib/api";
import { PROVIDER_LABELS } from "@/lib/providers";
import type { CiFileState, LocalStatus, Repository } from "@/lib/types";
import { cn, shortSha, timeAgo } from "@/lib/utils";
import { TimeAgo } from "../runs";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from "../ui/overlays";
import { Badge, Button, buttonClass, Card, EmptyState, SegmentedControl, Skeleton, Spinner } from "../ui/primitives";
import { PublicationCard } from "../editor/PublishFlow";
import { DiffViewer } from "./DiffViewer";
import { FolderField } from "./FolderField";

type LinkedStatus = Extract<LocalStatus, { linked: true }>;

const CI_STATE_TONES: Record<CiFileState, "success" | "running" | "accent" | "failure" | "muted"> = {
  synced: "success",
  uncommitted: "running",
  untracked: "running",
  unpushed: "accent",
  outdated: "running",
  diverged: "failure",
};

export const CI_FILE_STATES = Object.keys(CI_STATE_TONES) as CiFileState[];

export function ciStateInfo(state: CiFileState) {
  return { label: i18n.t(`local.ciStates.${state}.label`), description: i18n.t(`local.ciStates.${state}.description`), tone: CI_STATE_TONES[state] };
}

const TONES = {
  success: "border-success/25 bg-success/10 text-fg",
  running: "border-running/30 bg-running/10 text-fg",
  accent: "border-accent/25 bg-accent-soft text-fg",
  failure: "border-failure/30 bg-failure/10 text-fg",
  muted: "",
};
const DOTS = { success: "bg-success", running: "bg-running", accent: "bg-accent", failure: "bg-failure", muted: "bg-fg-subtle" };

export function CiStateBadge({ state }: { state: CiFileState }) {
  const info = ciStateInfo(state);
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
        <EmptyState icon={<TriangleAlert />} title={i18n.t("local.panel.statusUnavailable")} description={errorMessage(statusQuery.error)} />
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
            <h3 className="text-[15px] font-semibold">{i18n.t("local.panel.notLinkedTitle")}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
              {i18n.t("local.panel.notLinkedDescription")}
            </p>
          </div>
        </div>

        {overview?.git_version === null ? (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-failure/30 bg-failure/[0.06] p-3.5 text-[13px] text-fg-muted">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-failure" />
            {i18n.t("local.panel.gitMissing")}
          </div>
        ) : null}

        <SegmentedControl<"link" | "clone">
          value={mode}
          onChange={setMode}
          className="mt-5"
          options={[
            { value: "link", label: <><Link2 />{i18n.t("local.panel.linkExisting")}</> },
            { value: "clone", label: <><Download />{i18n.t("local.panel.cloneRepository")}</> },
          ]}
        />
        <div className="mt-4">{mode === "link" ? <LinkForm repo={repo} pickerAvailable={overview?.picker_available ?? false} /> : <CloneForm repo={repo} pickerAvailable={overview?.picker_available ?? false} defaultParent={overview?.roots[0]?.path ?? ""} />}</div>
      </Card>

      <Card className="p-5 text-[13px] leading-relaxed text-fg-muted">
        <div className="mb-2 flex items-center gap-2 font-semibold text-fg">
          <FolderGit2 className="size-4 text-accent" /> {i18n.t("local.panel.autoDetection")}
        </div>
        {noRoots ? (
          <p>
            <Trans i18nKey="local.panel.noRoots" components={{ code: <code className="font-mono text-[12px] text-fg" /> }} />
          </p>
        ) : (
          <p>
            {i18n.t("local.panel.scans", { count: overview?.roots.length ?? 0 })}{" "}
            {overview?.roots.map((root, index) => (
              <span key={root.path}>
                <code className="font-mono text-[12px] text-fg">{root.display_path}</code>
                {index < overview.roots.length - 1 ? ", " : ""}
              </span>
            ))}{" "}
            {i18n.t("local.panel.noCloneFound")}
          </p>
        )}
        <Link to="/settings#local" className={buttonClass("secondary", "sm", "mt-3")}>
          {noRoots ? i18n.t("local.panel.addRoot") : i18n.t("local.panel.manageRoots")} <ChevronRight className="size-3.5" />
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
        {i18n.t("local.panel.clonePath")}
      </label>
      <FolderField
        id="link-path"
        value={path}
        onChange={(value) => {
          setPath(value);
          link.reset();
        }}
        pickerAvailable={pickerAvailable}
        pickerTitle={i18n.t("local.panel.pickerTitle", { name: repo.full_name })}
        placeholder={`~/Developer/${repo.name}`}
      />
      {mismatch ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-running/30 bg-running/[0.07] p-3 text-[12.5px] text-fg-muted animate-fade-in">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-running" />
          <div className="flex-1">
            {mismatch} {i18n.t("local.panel.checkFolder")}
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={(event) => submit(event, true)} loading={link.isPending}>
                {i18n.t("local.panel.linkAnyway")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <Button type="submit" variant="primary" loading={link.isPending && !mismatch} disabled={!path.trim()}>
        <Link2 /> {i18n.t("local.panel.linkFolder")}
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
        {i18n.t("local.panel.cloneInto")}
      </label>
      <FolderField id="clone-parent" value={parent} onChange={setParent} pickerAvailable={pickerAvailable} pickerTitle={i18n.t("local.panel.clonePickerTitle")} />
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
          {protocol === "https" ? i18n.t("local.panel.httpsHint") : i18n.t("local.panel.sshHint")}
        </span>
      </div>
      {destination ? (
        <p className="text-[12.5px] text-fg-muted">
          {i18n.t("local.panel.destination")} <code className="font-mono text-[12px] text-fg">{destination}</code>
        </p>
      ) : null}
      <Button type="submit" variant="primary" loading={clone.isPending} disabled={!parent.trim()}>
        <Download /> {clone.isPending ? i18n.t("local.panel.cloning") : i18n.t("local.panel.clone", { name: repo.name })}
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
  const navigate = useNavigate();
  const generatePath = `/repos/${repo.provider}/${encodeURIComponent(repo.full_name)}/generate`;
  const editPath = (file?: string) => `/repos/${repo.provider}/${encodeURIComponent(repo.full_name)}/edit${file ? `?path=${encodeURIComponent(file)}` : ""}`;

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
                <Unlink /> {i18n.t("local.panel.unlinkAndChoose")}
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
  const pullBlocked = !status.upstream ? i18n.t("local.panel.pullBlocked.noUpstream") : status.dirty ? i18n.t("local.panel.pullBlocked.dirty") : ahead > 0 && behind > 0 ? i18n.t("local.panel.pullBlocked.diverged") : behind === 0 ? i18n.t("local.panel.pullBlocked.upToDate") : null;
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
              <Badge>{overview?.projects.find((p) => p.key === repo.key)?.source === "manual" ? i18n.t("local.panel.linkedManually") : i18n.t("local.panel.detectedAutomatically")}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-fg-muted">
              <span className="inline-flex items-center gap-1.5">
                <GitBranch className="size-3.5 text-fg-subtle" />
                <span className="font-mono text-fg">{status.detached ? i18n.t("publish.card.detached") : status.branch}</span>
                {status.upstream ? <span className="text-fg-subtle">→ {status.upstream}</span> : <span className="text-running">{i18n.t("local.panel.noUpstream")}</span>}
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
            <Tooltip content={i18n.t("local.panel.fetchTooltip")}>
              <Button onClick={() => sync.mutate({ key: repo.key, pull: false })} loading={busy && sync.variables?.pull === false}>
                <RefreshCw /> {i18n.t("local.panel.fetch")}
              </Button>
            </Tooltip>
            <Tooltip content={pullBlocked ?? i18n.t("local.panel.pullTooltip", { count: behind })}>
              <span>
                <Button
                  variant={behind > 0 && !pullBlocked ? "primary" : "secondary"}
                  onClick={() => sync.mutate({ key: repo.key, pull: true })}
                  loading={busy && sync.variables?.pull === true}
                  disabled={Boolean(pullBlocked)}
                >
                  <ArrowDownToLine /> {i18n.t("local.panel.pull")}
                </Button>
              </span>
            </Tooltip>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label={i18n.t("common.moreActions")}>
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<FolderOpen />} onSelect={() => open.mutate({ key: repo.key, target: "folder" })}>
                  {i18n.t("local.panel.showIn", { place: overview?.file_manager ?? "Finder" })}
                </MenuItem>
                <MenuItem
                  icon={<Code2 />}
                  disabled={!editor}
                  description={editor ? undefined : i18n.t("local.panel.noEditor")}
                  onSelect={() => open.mutate({ key: repo.key, target: "editor", editorId: editor?.id })}
                >
                  {editor ? i18n.t("local.panel.openIn", { editor: editor.label }) : i18n.t("local.panel.openInEditor")}
                </MenuItem>
                <MenuItem icon={<SquareTerminal />} onSelect={() => open.mutate({ key: repo.key, target: "terminal" })}>
                  {i18n.t("local.panel.openTerminal")}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<RefreshCw />} onSelect={onRefresh}>
                  {i18n.t("local.panel.refreshStatus")}
                </MenuItem>
                <MenuItem icon={<Unlink />} description={i18n.t("local.panel.unlinkDescription")} destructive onSelect={() => unlink.mutate(repo.key)}>
                  {i18n.t("local.panel.unlink")}
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <Metric
            icon={<ArrowDown />}
            label={i18n.t("local.panel.metrics.behind")}
            value={behind}
            tone={behind > 0 ? "running" : "muted"}
            hint={behind > 0 ? i18n.t("local.panel.metrics.behindHint", { count: behind, upstream: status.upstream }) : i18n.t("local.panel.metrics.upToDate")}
          />
          <Metric icon={<ArrowUp />} label={i18n.t("local.panel.metrics.ahead")} value={ahead} tone={ahead > 0 ? "accent" : "muted"} hint={ahead > 0 ? i18n.t("local.panel.metrics.aheadHint", { count: ahead }) : i18n.t("local.panel.metrics.nothingPending")} />
          <Metric
            icon={<FileCode2 />}
            label={i18n.t("local.panel.metrics.uncommitted")}
            value={status.changes_count ?? 0}
            tone={status.dirty ? "running" : "muted"}
            hint={status.dirty ? i18n.t("local.panel.metrics.modifiedFiles") : i18n.t("local.panel.metrics.clean")}
          />
          <Metric
            icon={<RefreshCw className={cn(refreshing && "animate-spin")} />}
            label={i18n.t("local.panel.metrics.lastFetch")}
            text={status.last_fetch_at ? timeAgo(new Date(status.last_fetch_at * 1000).toISOString(), now) : i18n.t("local.panel.metrics.never")}
            tone="muted"
            hint={settings?.auto_fetch_minutes ? i18n.t("local.panel.metrics.autoEvery", { minutes: settings.auto_fetch_minutes }) : i18n.t("local.panel.metrics.autoOff")}
          />
        </div>

        {!status.remote_matches ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-running/30 bg-running/[0.07] p-3 text-[12.5px] text-fg-muted">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-running" />
            {i18n.t("local.panel.remoteMismatch", { name: repo.full_name, provider: providerLabel, ref: status.compare_ref ?? i18n.t("local.panel.noRemoteBranch") })}
          </div>
        ) : null}
      </Card>

      <PublicationCard repoKey={repo.key} provider={repo.provider} status={status} onCommit={() => navigate(editPath((status.ci_files ?? []).find((f) => f.state === "uncommitted" || f.state === "untracked")?.path))} />

      {/* Fichiers CI */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <FileCode2 className="size-4 text-fg-subtle" />
          <h3 className="text-[13.5px] font-semibold">{i18n.t("local.panel.ciFiles")}</h3>
          <span className="text-[12.5px] text-fg-subtle">{i18n.t("local.panel.comparedTo", { ref: status.compare_ref ?? "—" })}</span>
          <Tooltip content={i18n.t("local.panel.generateTooltip")}>
            <Link to={generatePath} className={buttonClass(ciFiles.some((f) => f.local) ? "ghost" : "primary", "sm", "ml-auto")}>
              <Zap className="size-3.5" /> {ciFiles.some((f) => f.local) ? i18n.t("local.panel.generate") : i18n.t("local.panel.generateCi")}
            </Link>
          </Tooltip>
          <Link to={editPath()} className={buttonClass("ghost", "sm")}>
            {ciFiles.some((f) => f.local) ? <Pencil className="size-3.5" /> : <FilePlus2 className="size-3.5" />}
            {ciFiles.some((f) => f.local) ? i18n.t("local.panel.openEditor") : i18n.t("local.panel.writeByHand")}
          </Link>
        </div>
        {ciFiles.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-fg-muted">
            {i18n.t("local.panel.noCiFiles", { config: PROVIDER_LABELS[repo.provider].config })}
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
                    {!file.local ? <span className="text-[12px] text-fg-subtle">{i18n.t("local.panel.missingLocally")}</span> : null}
                    <CiStateBadge state={file.state} />
                    {file.local ? (
                      <Tooltip content={i18n.t("local.panel.editLocally")}>
                        <span
                          role="link"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(editPath(file.path));
                          }}
                          className={buttonClass("ghost", "icon-sm")}
                        >
                          <Pencil className="size-3.5" />
                        </span>
                      </Tooltip>
                    ) : null}
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
              {i18n.t("local.panel.otherChanges")}
              <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-medium text-fg-muted tabular">{otherChanges.length}</span>
            </summary>
            <ul className="divide-y divide-line border-t border-line">
              {otherChanges.slice(0, 50).map((change) => (
                <li key={change.path} className="flex items-center gap-3 px-4 py-1.5 text-[12.5px]">
                  <code className="min-w-0 flex-1 truncate font-mono">{change.path}</code>
                  <span className="text-fg-subtle">{isChangeKind(change.status) ? i18n.t(`local.changes.${change.status}`) : change.status}</span>
                </li>
              ))}
            </ul>
          </details>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2/50 p-3.5 text-[12.5px] leading-relaxed text-fg-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <p>
          {i18n.t("local.panel.consentNote")}
        </p>
      </div>
    </div>
  );
}

const CHANGE_KINDS = ["modified", "added", "deleted", "renamed", "copied", "untracked", "conflict"] as const;

function isChangeKind(status: string): status is (typeof CHANGE_KINDS)[number] {
  return (CHANGE_KINDS as readonly string[]).includes(status);
}

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
          <Spinner className="size-3.5" /> {i18n.t("local.panel.comparing")}
        </div>
      ) : query.error ? (
        <p className="text-[12.5px] text-failure">{errorMessage(query.error)}</p>
      ) : query.data?.diff ? (
        <DiffViewer diff={query.data.diff} />
      ) : (
        <p className="flex items-center gap-2 text-[12.5px] text-fg-muted">
          <Check className="size-3.5 text-success" /> {i18n.t("local.panel.noDifference", { ref: query.data?.compare_ref })}
        </p>
      )}
    </div>
  );
}
