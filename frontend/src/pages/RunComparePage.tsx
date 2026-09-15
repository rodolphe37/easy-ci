import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode2,
  GitCommitHorizontal,
  GitCompareArrows,
  Info,
  RotateCcw,
  Timer,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import i18n from "@/i18n";
import { BranchChip, MetaItem, RunDuration, TimeAgo } from "@/components/runs";
import { isActive, StatusIcon, stateLabel } from "@/components/status";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from "@/components/ui/overlays";
import { Avatar, Badge, Button, Card, EmptyState, Skeleton } from "@/components/ui/primitives";
import { api, type RepoRef } from "@/lib/api";
import { comparePath, PROVIDER_LABELS, repoKey, runPath, useRepoRef } from "@/lib/providers";
import type { CommitRange, CompareFile, JobChange, JobComparison, Run, RunComparison } from "@/lib/types";
import { cn, firstLine, formatDuration, shortSha, timeAgo } from "@/lib/utils";
import { Page } from "./OverviewPage";

const CHANGE_TONES: Record<JobChange, string> = {
  broken: "border-failure/30 bg-failure/10 text-failure",
  still_failing: "border-failure/20 bg-failure/[0.06] text-failure",
  fixed: "border-success/30 bg-success/10 text-success",
  added: "border-accent/30 bg-accent/10 text-accent",
  removed: "border-line bg-surface-2 text-fg-muted",
  changed: "border-line bg-surface-2 text-fg",
  slower: "border-running/30 bg-running/10 text-running",
  faster: "border-success/25 bg-success/[0.08] text-success",
  unchanged: "border-line bg-surface-2 text-fg-subtle",
};

const signed = (value: number, format: (abs: number) => string) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${format(Math.abs(value))}`;
const signedPercent = (ratio: number) => signed(ratio, (abs) => `${Math.round(abs * 100)} %`);

/**
 * Comparaison de deux exécutions d'un même workflow : jobs cassés ou réparés, écarts de durée
 * et commits qui les séparent. La référence est choisie par le moteur ou dans la liste (?base=).
 */
export function RunComparePage() {
  const repoRef = useRepoRef();
  const key = repoKey(repoRef.provider, repoRef.full_name);
  const { runId = "" } = useParams();
  const [params] = useSearchParams();
  const baseId = params.get("base");

  const query = useQuery({
    queryKey: ["compare", key, runId, baseId],
    queryFn: () => api.compareRuns(repoRef, runId, baseId),
    staleTime: 60_000,
    placeholderData: (previous) => (previous?.head.id === runId ? previous : undefined),
  });
  const data = query.data;

  if (query.error) {
    return (
      <Page className="max-w-5xl">
        <Card>
          <EmptyState icon={<TriangleAlert />} title={i18n.t("common.loadFailed")} description={query.error.message} />
        </Card>
      </Page>
    );
  }

  if (!data) return <CompareSkeleton />;

  const { head, base } = data;
  return (
    <Page className={cn("max-w-5xl", query.isFetching && "opacity-80 transition-opacity")}>
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <GitCompareArrows className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight">{i18n.t("compare.title")}</h1>
          <p className="mt-0.5 text-[13px] text-fg-muted">{i18n.t("compare.subtitle", { workflow: head.name, number: head.run_number })}</p>
        </div>
      </div>

      <div className="mt-6 grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <RunCard
          label={i18n.t("compare.base")}
          run={base}
          repoRef={repoRef}
          footer={base ? <BaselineReason data={data} /> : undefined}
          action={<BasePicker repoRef={repoRef} head={head} currentBaseId={base?.id ?? null} manual={data.baseline === "manual"} />}
        />
        <div className="hidden items-center justify-center text-fg-subtle md:flex">
          <ArrowRight className="size-5" />
        </div>
        <RunCard label={i18n.t("compare.head")} run={head} repoRef={repoRef} />
      </div>

      {base && data.summary ? (
        <>
          <Insights data={data} />
          <SummaryTiles data={data} />
          <JobsCard repoRef={repoRef} data={data} />
          <CommitsCard repoRef={repoRef} data={data} />
        </>
      ) : (
        <Card className="mt-5">
          <EmptyState
            icon={<GitCompareArrows />}
            title={i18n.t("compare.noBaseTitle")}
            description={i18n.t("compare.noBaseDescription", { branch: head.branch ?? "—" })}
            action={<BasePicker repoRef={repoRef} head={head} currentBaseId={null} manual={false} prominent />}
          />
        </Card>
      )}
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Exécutions comparées                                                       */
/* -------------------------------------------------------------------------- */

function RunCard({ label, run, repoRef, footer, action }: { label: string; run: Run | null; repoRef: RepoRef; footer?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col px-4 py-3.5">
      <div className="flex h-6 items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">{label}</span>
        {action}
      </div>
      {run ? (
        <Link to={runPath(repoRef.provider, repoRef.full_name, run.id)} className="group mt-2 flex min-w-0 items-start gap-3">
          <StatusIcon state={run.state} className="mt-0.5 size-[18px]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium group-hover:underline">{firstLine(run.commit_message) || run.title}</div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
              <span className="text-fg-muted">
                {run.name} <span className="text-fg-subtle">#{run.run_number}</span>
              </span>
              <BranchChip branch={run.branch} />
              <MetaItem icon={<GitCommitHorizontal />} className="font-mono text-[11.5px]">
                {shortSha(run.head_sha)}
              </MetaItem>
            </div>
            <div className="mt-1 flex items-center gap-3 text-[12px] text-fg-muted">
              <TimeAgo date={run.created_at} />
              <RunDuration run={run} className="text-fg-subtle" />
            </div>
          </div>
        </Link>
      ) : (
        <div className="mt-2 text-[13px] text-fg-subtle">—</div>
      )}
      {footer ? <div className="mt-2.5 border-t border-line pt-2 text-[11.5px] text-fg-subtle">{footer}</div> : null}
    </Card>
  );
}

function BaselineReason({ data }: { data: RunComparison }) {
  const { base, head, baseline } = data;
  if (!base || !baseline) return null;
  if (baseline === "manual") return <>{i18n.t("compare.baselineManual")}</>;
  const success = head.state !== "success";
  const branch = base.branch ?? "—";
  if (baseline === "default_branch") return <>{i18n.t(success ? "compare.baselineDefaultSuccess" : "compare.baselineDefaultPrevious", { branch })}</>;
  return <>{i18n.t(success ? "compare.baselineSuccess" : "compare.baselinePrevious", { branch })}</>;
}

function BasePicker({ repoRef, head, currentBaseId, manual, prominent = false }: { repoRef: RepoRef; head: Run; currentBaseId: string | null; manual: boolean; prominent?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const key = repoKey(repoRef.provider, repoRef.full_name);
  const runs = useQuery({
    queryKey: ["runs", key, head.workflow_id, "compare-candidates"],
    queryFn: () => api.listRuns(repoRef, { workflow_id: head.workflow_id }),
    enabled: open || prominent,
    staleTime: 60_000,
  });
  const candidates = (runs.data?.runs ?? []).filter((run) => run.id !== head.id && !isActive(run.state)).slice(0, 20);
  const select = (baseRunId: string | null) => navigate(comparePath(repoRef.provider, repoRef.full_name, head.id, baseRunId), { replace: true });

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>
        <Button variant={prominent ? "primary" : "ghost"} size="sm" className={prominent ? undefined : "-mr-1.5"} aria-label={i18n.t("compare.chooseBase")}>
          {prominent ? i18n.t("compare.chooseBase") : i18n.t("compare.changeBase")} <ChevronDown className="-mr-0.5 size-3.5 opacity-70" />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <div className="max-h-80 overflow-y-auto">
          {manual ? (
            <>
              <MenuItem icon={<RotateCcw />} description={i18n.t("compare.autoBaseDescription")} onSelect={() => select(null)}>
                {i18n.t("compare.autoBase")}
              </MenuItem>
              <MenuSeparator />
            </>
          ) : null}
          {runs.isLoading ? (
            <div className="space-y-2 p-2.5">
              <Skeleton className="w-56" />
              <Skeleton className="w-44" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="px-2.5 py-2 text-[12.5px] text-fg-subtle">{i18n.t("compare.noCandidates")}</div>
          ) : (
            candidates.map((run) => (
              <MenuItem
                key={run.id}
                icon={<StatusIcon state={run.state} />}
                description={`#${run.run_number} · ${run.branch ?? "—"} · ${timeAgo(run.created_at)}`}
                onSelect={() => select(run.id)}
                disabled={run.id === currentBaseId}
              >
                <span className="block max-w-72 truncate">{firstLine(run.commit_message) || run.title}</span>
              </MenuItem>
            ))
          )}
        </div>
      </MenuContent>
    </Menu>
  );
}

/* -------------------------------------------------------------------------- */
/* Résumé                                                                     */
/* -------------------------------------------------------------------------- */

function Insights({ data }: { data: RunComparison }) {
  const { summary, commits, head, base } = data;
  if (!summary || !base) return null;
  const items: { tone: "warning" | "info"; text: string }[] = [];
  if (summary.same_commit) {
    if (head.state === "failure") items.push({ tone: "warning", text: i18n.t("compare.insights.sameCommitFailure") });
    else if (summary.fixed > 0) items.push({ tone: "warning", text: i18n.t("compare.insights.sameCommitFixed") });
    else items.push({ tone: "info", text: i18n.t("compare.insights.sameCommit") });
  }
  if (commits?.ci_config_changed) items.push({ tone: "info", text: i18n.t("compare.insights.ciConfigChanged") });
  if (commits?.status === "behind") items.push({ tone: "info", text: i18n.t("compare.insights.behind") });
  else if (!summary.same_branch && !summary.same_commit && base.branch) items.push({ tone: "info", text: i18n.t("compare.insights.otherBranch", { branch: base.branch }) });
  else if (commits?.status === "diverged") items.push({ tone: "info", text: i18n.t("compare.insights.diverged") });
  if (!items.length) return null;

  return (
    <div className="mt-4 flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.text}
          className={cn(
            "flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px]",
            item.tone === "warning" ? "border-running/30 bg-running/[0.07] text-fg" : "border-line bg-surface-2/60 text-fg-muted",
          )}
        >
          {item.tone === "warning" ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-running" /> : <Info className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
          {item.text}
        </div>
      ))}
    </div>
  );
}

function SummaryTiles({ data }: { data: RunComparison }) {
  const summary = data.summary!;
  const commits = data.commits;
  const commitCount = summary.same_commit ? 0 : commits?.status === "behind" ? 0 : (commits?.total_commits ?? null);
  const fileCount = summary.same_commit ? 0 : (commits?.files_total ?? null);
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
      <Tile icon={<StatusIcon state="failure" className="size-3.5" />} label={i18n.t("compare.tiles.broken")} value={String(summary.broken)} highlight={summary.broken > 0 ? "text-failure" : undefined} />
      <Tile icon={<StatusIcon state="success" className="size-3.5" />} label={i18n.t("compare.tiles.fixed")} value={String(summary.fixed)} highlight={summary.fixed > 0 ? "text-success" : undefined} />
      <Tile
        icon={<GitCommitHorizontal />}
        label={i18n.t("compare.tiles.commits")}
        value={commitCount == null ? (commits?.commits.length ? `${commits.commits.length}+` : "—") : String(commitCount)}
      />
      <Tile icon={<FileCode2 />} label={i18n.t("compare.tiles.files")} value={fileCount == null ? (commits?.files.length ? `${commits.files.length}+` : "—") : String(fileCount)} />
      <Tile
        icon={<Timer />}
        label={i18n.t("compare.tiles.duration")}
        value={summary.duration_delta_s == null ? "—" : signed(summary.duration_delta_s, formatDuration)}
        hint={summary.duration_change == null ? undefined : signedPercent(summary.duration_change)}
        className="col-span-2 md:col-span-1"
      />
    </div>
  );
}

function Tile({ icon, label, value, hint, highlight, className }: { icon: ReactNode; label: string; value: string; hint?: string; highlight?: string; className?: string }) {
  return (
    <Card className={cn("px-4 py-3", className)}>
      <div className="flex items-center gap-1.5 text-[12px] text-fg-muted [&_svg]:size-3.5 [&_svg]:text-fg-subtle">
        {icon}
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn("text-[22px] leading-tight font-semibold tracking-tight tabular", highlight)}>{value}</span>
        {hint ? <span className="text-[12px] text-fg-subtle tabular">{hint}</span> : null}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

function JobsCard({ repoRef, data }: { repoRef: RepoRef; data: RunComparison }) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const changed = data.jobs.filter((job) => job.change !== "unchanged");
  const unchanged = data.jobs.length - changed.length;
  const visible = showUnchanged ? data.jobs : changed;

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="text-[13.5px] font-semibold">{i18n.t("compare.jobs")}</h2>
        {unchanged > 0 && changed.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setShowUnchanged((value) => !value)}>
            {showUnchanged ? i18n.t("compare.hideUnchanged") : i18n.t("compare.showUnchanged", { count: unchanged })}
          </Button>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-fg-muted">
          {i18n.t("compare.noJobChange")}{" "}
          {unchanged > 0 ? (
            <button type="button" className="text-accent hover:underline" onClick={() => setShowUnchanged(true)}>
              {i18n.t("compare.showUnchanged", { count: unchanged })}
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((job) => (
            <JobRow key={job.name} job={job} repoRef={repoRef} data={data} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function JobRow({ job, repoRef, data }: { job: JobComparison; repoRef: RepoRef; data: RunComparison }) {
  const target = job.head ? { runId: data.head.id, jobId: job.head.id } : job.base && data.base ? { runId: data.base.id, jobId: job.base.id } : null;
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium">{job.name}</span>
          {job.stage ? <span className="shrink-0 text-[11.5px] text-fg-subtle">{job.stage}</span> : null}
        </div>
        {job.head?.failed_step && job.change !== "unchanged" ? (
          <div className="mt-0.5 truncate text-[12px] text-failure">{i18n.t("compare.failedAt", { step: job.head.failed_step })}</div>
        ) : null}
      </div>
      <span className={cn("hidden h-5 shrink-0 items-center rounded-md border px-1.5 text-[11px] font-medium sm:inline-flex", CHANGE_TONES[job.change])}>
        {i18n.t(`compare.changes.${job.change}`)}
      </span>
      <div className="grid w-[244px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 text-[12px]">
        <JobSide side={job.base} />
        <ArrowRight className="size-3.5 text-fg-subtle" />
        <JobSide side={job.head} />
      </div>
      <div className={cn("w-20 shrink-0 text-right text-[12px] tabular", job.change === "slower" ? "text-running" : job.change === "faster" ? "text-success" : "text-fg-subtle")}>
        {job.duration_delta_s == null || job.duration_delta_s === 0 ? "" : signed(job.duration_delta_s, formatDuration)}
      </div>
    </>
  );
  return (
    <li>
      {target ? (
        <Link to={`${runPath(repoRef.provider, repoRef.full_name, target.runId)}?job=${encodeURIComponent(target.jobId)}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60">
          {content}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-4 py-2.5">{content}</div>
      )}
    </li>
  );
}

function JobSide({ side }: { side: JobComparison["base"] }) {
  if (!side) return <span className="text-fg-subtle italic">{i18n.t("compare.absent")}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-fg-muted">
      <Tooltip content={side.allow_failure ? i18n.t("run.allowFailureTooltip") : stateLabel(side.state)}>
        <span className="inline-flex">
          <StatusIcon state={side.state} className="size-3.5" />
        </span>
      </Tooltip>
      <span className="tabular">{formatDuration(side.duration_s)}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Commits                                                                    */
/* -------------------------------------------------------------------------- */

function CommitsCard({ repoRef, data }: { repoRef: RepoRef; data: RunComparison }) {
  const { commits, summary, base } = data;
  const providerLabel = PROVIDER_LABELS[repoRef.provider].label;

  if (summary?.same_commit) {
    return (
      <Card className="mt-4 flex items-center gap-3 px-4 py-3.5">
        <GitCommitHorizontal className="size-4 text-fg-subtle" />
        <div className="text-[13px]">
          <span className="font-medium">{i18n.t("compare.noNewCommit")}</span>
          <span className="text-fg-muted"> · {i18n.t("compare.sameCommitDescription", { sha: shortSha(base?.head_sha) })}</span>
        </div>
      </Card>
    );
  }
  if (!commits) {
    return data.commits_error ? (
      <Card className="mt-4 flex items-center gap-3 px-4 py-3.5 text-[13px] text-fg-muted">
        <TriangleAlert className="size-4 shrink-0 text-running" />
        {i18n.t("compare.commitsError", { error: data.commits_error })}
      </Card>
    ) : null;
  }

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="text-[13.5px] font-semibold">
          <CommitsTitle commits={commits} />
        </h2>
        {commits.html_url ? (
          <Button variant="ghost" size="sm" onClick={() => void api.openExternal(commits.html_url!)}>
            <ExternalLink className="size-3.5" /> {i18n.t("compare.viewDiffOn", { provider: providerLabel })}
          </Button>
        ) : null}
      </div>
      {commits.commits.length ? (
        <ul className="divide-y divide-line">
          {commits.commits.map((commit) => (
            <li key={commit.sha} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar login={commit.author.login ?? commit.author.name} src={commit.author.avatar_url} size={20} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{commit.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[12px] text-fg-muted">
                  <span className="truncate">{commit.author.name ?? commit.author.login}</span>
                  {commit.date ? <TimeAgo date={commit.date} className="text-fg-subtle" /> : null}
                </div>
              </div>
              {commit.html_url ? (
                <Tooltip content={i18n.t("common.openOn", { provider: providerLabel })}>
                  <button type="button" onClick={() => void api.openExternal(commit.html_url!)} className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] text-fg-muted hover:bg-surface-2 hover:text-fg">
                    {shortSha(commit.sha)}
                  </button>
                </Tooltip>
              ) : (
                <span className="shrink-0 font-mono text-[11.5px] text-fg-subtle">{shortSha(commit.sha)}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {commits.commits_truncated ? <div className="border-t border-line px-4 py-2 text-[12px] text-fg-subtle">{i18n.t("compare.moreCommits", { count: commits.commits.length })}</div> : null}
      {commits.files.length ? <FilesList commits={commits} /> : null}
    </Card>
  );
}

function CommitsTitle({ commits }: { commits: CommitRange }) {
  if (commits.status === "behind") return <>{i18n.t("compare.commitsBehind", { count: commits.behind_by ?? 0 })}</>;
  if (commits.total_commits == null) return <>{i18n.t("compare.commitsTitleUnknown", { count: commits.commits.length })}</>;
  return <>{i18n.t("compare.commitsTitle", { count: commits.total_commits })}</>;
}

const FILE_STATUS_LETTERS: Record<CompareFile["status"], { letter: string; className: string }> = {
  added: { letter: "A", className: "text-success" },
  removed: { letter: "D", className: "text-failure" },
  modified: { letter: "M", className: "text-running" },
  renamed: { letter: "R", className: "text-accent" },
};

function FilesList({ commits }: { commits: CommitRange }) {
  const files = useMemo(() => [...commits.files].sort((a, b) => Number(b.ci_config) - Number(a.ci_config)), [commits.files]);
  const [open, setOpen] = useState(commits.ci_config_changed || files.length <= 8);
  const count = commits.files_total ?? files.length;

  return (
    <div className="border-t border-line">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium transition-colors hover:bg-surface-2/60">
        <ChevronRight className={cn("size-4 text-fg-subtle transition-transform", open && "rotate-90")} />
        {i18n.t("compare.filesTitle", { count })}
        {commits.ci_config_changed ? (
          <Badge className="border-accent/30 bg-accent/10 text-accent">
            <Wrench /> {i18n.t("compare.ciBadge")}
          </Badge>
        ) : null}
      </button>
      {open ? (
        <ul className="border-t border-line bg-surface-2/30 py-1">
          {files.map((file) => {
            const status = FILE_STATUS_LETTERS[file.status];
            return (
              <li key={`${file.previous_path ?? ""}:${file.path}`} className="flex items-center gap-3 px-4 py-1">
                <Tooltip content={file.previous_path ? i18n.t("compare.renamedFrom", { path: file.previous_path }) : i18n.t(`compare.fileStatus.${file.status}`)}>
                  <span className={cn("w-3 shrink-0 text-center font-mono text-[11.5px] font-semibold", status.className)}>{status.letter}</span>
                </Tooltip>
                <span className={cn("min-w-0 flex-1 truncate font-mono text-[12px]", file.ci_config ? "text-fg" : "text-fg-muted")}>{file.path}</span>
                {file.ci_config ? <Badge className="border-accent/30 bg-accent/10 text-accent">{i18n.t("compare.ciBadge")}</Badge> : null}
                <span className="w-24 shrink-0 text-right font-mono text-[11.5px] tabular">
                  {file.additions != null ? <span className="text-success">+{file.additions}</span> : null}
                  {file.deletions != null ? <span className="ml-1.5 text-failure">−{file.deletions}</span> : null}
                </span>
              </li>
            );
          })}
          {commits.files_truncated ? <li className="px-4 py-1.5 text-[12px] text-fg-subtle">{i18n.t("compare.moreFiles", { count: files.length })}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function CompareSkeleton() {
  return (
    <Page className="max-w-5xl">
      <Skeleton className="h-7 w-72" />
      <Skeleton className="mt-2 w-96" />
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <div className="mt-4 grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-[74px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-60 rounded-xl" />
    </Page>
  );
}
