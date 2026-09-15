import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowDownRight, ArrowUpRight, ChartColumn, Info, Layers, RefreshCw, Timer, TriangleAlert } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import i18n from "@/i18n";
import { STATE_COLORS, StatusIcon, stateLabel } from "@/components/status";
import { Tooltip } from "@/components/ui/overlays";
import { Badge, Button, Card, EmptyState, SegmentedControl, Skeleton } from "@/components/ui/primitives";
import { api, type RepoRef } from "@/lib/api";
import { repoKey, runPath } from "@/lib/providers";
import type { JobStats, RunStats, ScannedWorkflow, StatsRunPoint } from "@/lib/types";
import { cn, formatDate, formatDuration } from "@/lib/utils";

const LIMITS = [20, 50, 100] as const;

const percent = (ratio: number | null | undefined) => (ratio == null ? "—" : `${Math.round(ratio * 100)} %`);

/**
 * Statistiques d'un dépôt dans le temps : taux de réussite, durées des exécutions,
 * jobs lents ou instables. Calculées par le moteur sur les dernières exécutions terminées.
 */
export function RunStatsPanel({
  repoRef,
  workflows,
  defaultBranch,
  workflowId,
  onWorkflowChange,
}: {
  repoRef: RepoRef;
  workflows: ScannedWorkflow[];
  defaultBranch: string | null;
  workflowId: string | null;
  onWorkflowChange: (id: string | null) => void;
}) {
  const [limit, setLimit] = useState<number>(50);
  const [branchOnly, setBranchOnly] = useState(false);
  const branch = branchOnly && defaultBranch ? defaultBranch : null;

  const query = useQuery({
    queryKey: ["run-stats", repoKey(repoRef.provider, repoRef.full_name), workflowId, branch, limit],
    queryFn: () => api.getRunStats(repoRef, { workflow_id: workflowId, branch, limit }),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
  const stats = query.data;
  const showWorkflow = !workflowId && workflows.length > 1;

  return (
    <div className={cn("grid gap-5", workflows.length > 1 && "lg:grid-cols-[220px_minmax(0,1fr)]")}>
      {workflows.length > 1 ? (
        <div className="flex flex-col gap-0.5">
          <FilterButton active={!workflowId} onClick={() => onWorkflowChange(null)} icon={<Layers className="size-4 text-fg-subtle" />}>
            {i18n.t("repo.allWorkflows")}
          </FilterButton>
          {workflows.map((wf) => (
            <FilterButton key={wf.id} active={workflowId === String(wf.id)} onClick={() => onWorkflowChange(String(wf.id))} icon={<StatusIcon state={wf.latest_run?.state ?? "none"} className="size-3.5" />}>
              {wf.name}
            </FilterButton>
          ))}
        </div>
      ) : null}

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<number> value={limit} onChange={setLimit} options={LIMITS.map((value) => ({ value, label: i18n.t("stats.lastRuns", { count: value }) }))} />
          {defaultBranch ? (
            <SegmentedControl<string>
              value={branchOnly ? "default" : "all"}
              onChange={(value) => setBranchOnly(value === "default")}
              options={[
                { value: "all", label: i18n.t("stats.allBranches") },
                { value: "default", label: defaultBranch },
              ]}
            />
          ) : null}
          <div className="ml-auto flex items-center gap-2 text-[12px] text-fg-subtle">
            {stats?.summary.first_run_at ? (
              <span className="tabular">{i18n.t("stats.period", { from: formatDate(stats.summary.first_run_at), to: formatDate(stats.summary.last_run_at) })}</span>
            ) : null}
            <Tooltip content={i18n.t("common.refresh")}>
              <Button variant="ghost" size="icon" onClick={() => void query.refetch()} aria-label={i18n.t("common.refresh")}>
                <RefreshCw className={cn(query.isFetching && "animate-spin")} />
              </Button>
            </Tooltip>
          </div>
        </div>

        {query.isPending ? (
          <StatsSkeleton />
        ) : query.error && !stats ? (
          <Card>
            <EmptyState icon={<TriangleAlert />} title={i18n.t("common.loadFailed")} description={query.error.message} />
          </Card>
        ) : !stats || stats.runs_analyzed === 0 ? (
          <Card>
            <EmptyState icon={<ChartColumn />} title={i18n.t("stats.empty.title")} description={i18n.t("stats.empty.description")} />
          </Card>
        ) : (
          <div className={cn("space-y-4 transition-opacity", query.isFetching && query.isPlaceholderData && "opacity-60")}>
            <SummaryTiles stats={stats} />
            <DurationChart stats={stats} repoRef={repoRef} showWorkflow={showWorkflow} />
            <JobsTable jobs={stats.jobs} showWorkflow={showWorkflow} />
            <p className="flex items-start gap-1.5 px-1 text-[12px] leading-relaxed text-fg-subtle">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {i18n.t("stats.footnote", { count: stats.runs_analyzed })}
                {stats.incomplete_runs ? ` ${i18n.t("stats.incomplete", { count: stats.incomplete_runs })}` : ""}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors",
        active ? "bg-surface-2 font-medium text-fg ring-1 ring-line ring-inset" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Indicateurs                                                                */
/* -------------------------------------------------------------------------- */

function SummaryTiles({ stats }: { stats: RunStats }) {
  const { summary } = stats;
  const change = summary.trend?.change ?? null;
  // Une variation de moins de 5 % relève du bruit : on ne l'affiche pas comme une tendance.
  const significant = change !== null && Math.abs(change) >= 0.05;
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Tile icon={<Activity />} label={i18n.t("stats.successRate")} value={percent(summary.success_rate)} hint={i18n.t("stats.successHint", { success: summary.success, failure: summary.failure })} />
      <Tile
        icon={<Timer />}
        label={i18n.t("stats.medianDuration")}
        value={formatDuration(summary.duration.median)}
        hint={
          significant ? (
            <span className={cn("inline-flex items-center gap-0.5 font-medium", change! > 0 ? "text-failure" : "text-success")}>
              {change! > 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {i18n.t(change! > 0 ? "stats.slower" : "stats.faster", { value: Math.round(Math.abs(change!) * 100) })}
            </span>
          ) : summary.trend ? (
            i18n.t("stats.stable")
          ) : (
            i18n.t("stats.average", { value: formatDuration(summary.duration.average) })
          )
        }
      />
      <Tile icon={<Timer />} label={i18n.t("stats.p90Duration")} value={formatDuration(summary.duration.p90)} hint={i18n.t("stats.p90Hint", { value: formatDuration(summary.duration.max) })} />
      <Tile
        icon={<TriangleAlert />}
        label={i18n.t("stats.unstableJobs")}
        value={String(stats.unstable_jobs)}
        hint={stats.unstable_jobs ? i18n.t("stats.unstableHint") : i18n.t("stats.noUnstable")}
        tone={stats.unstable_jobs ? "warning" : undefined}
      />
    </div>
  );
}

function Tile({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint?: ReactNode; tone?: "warning" }) {
  return (
    <Card className="px-4 py-3.5">
      <div className={cn("flex items-center gap-1.5 text-[12.5px] text-fg-muted [&_svg]:size-3.5", tone === "warning" ? "[&_svg]:text-running" : "[&_svg]:text-fg-subtle")}>
        {icon}
        {label}
      </div>
      <div className="mt-1 text-[24px] leading-tight font-semibold tracking-tight tabular">{value}</div>
      {hint ? <div className="mt-0.5 text-[11.5px] text-fg-subtle">{hint}</div> : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Graphique des durées                                                       */
/* -------------------------------------------------------------------------- */

const CHART_HEIGHT = 168;

/** Graduation courte de l'axe : « 45 s », « 1 min 30 », « 2 h ». */
function axisLabel(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) {
    const rest = Math.round(seconds % 60);
    return `${Math.floor(seconds / 60)} min${rest ? ` ${String(rest).padStart(2, "0")}` : ""}`;
  }
  const minutes = Math.round((seconds % 3600) / 60);
  return `${Math.floor(seconds / 3600)} h${minutes ? ` ${String(minutes).padStart(2, "0")}` : ""}`;
}

function niceMax(value: number) {
  const steps = [30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600, 7200, 10800, 21600];
  return steps.find((step) => step >= value) ?? Math.ceil(value / 3600) * 3600;
}

function DurationChart({ stats, repoRef, showWorkflow }: { stats: RunStats; repoRef: RepoRef; showWorkflow: boolean }) {
  const navigate = useNavigate();
  const points = stats.runs;
  const median = stats.summary.duration.median;
  const max = niceMax(Math.max(1, ...points.map((point) => point.duration_s ?? 0)));
  const ticks = [max, max / 2, 0];

  return (
    <Card className="px-4 pt-3.5 pb-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 className="text-[13.5px] font-semibold">{i18n.t("stats.chartTitle")}</h3>
        <div className="flex items-center gap-3 text-[11.5px] text-fg-muted">
          {(["success", "failure", "cancelled"] as const).map((state) => (
            <span key={state} className="inline-flex items-center gap-1">
              <StatusIcon state={state} className="size-3" />
              {stateLabel(state)}
            </span>
          ))}
          {median !== null ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 border-t border-dashed border-fg-muted" />
              {i18n.t("stats.median")}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative w-14 shrink-0 text-right text-[10.5px] text-fg-subtle tabular" style={{ height: CHART_HEIGHT }}>
          {ticks.map((tick, index) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}>
              {tick === 0 ? "0" : axisLabel(tick)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: CHART_HEIGHT }}>
          {ticks.map((tick, index) => (
            <div key={tick} className={cn("absolute inset-x-0 border-t", index === ticks.length - 1 ? "border-line-strong" : "border-line/70")} style={{ top: `${(index / (ticks.length - 1)) * 100}%` }} />
          ))}
          {median !== null ? (
            <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-fg-muted/70" style={{ bottom: `${(median / max) * 100}%` }} />
          ) : null}
          <div className="absolute inset-0 flex items-end justify-between gap-[2px]">
            {points.map((point) => (
              <DurationBar key={`${point.id}:${point.attempt}`} point={point} max={max} showWorkflow={showWorkflow} onOpen={() => navigate(runPath(repoRef.provider, repoRef.full_name, point.id))} />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1.5 ml-16 flex justify-between text-[10.5px] text-fg-subtle tabular">
        <span>{formatDate(points[0]?.created_at)}</span>
        <span>{formatDate(points[points.length - 1]?.created_at)}</span>
      </div>
    </Card>
  );
}

function DurationBar({ point, max, showWorkflow, onOpen }: { point: StatsRunPoint; max: number; showWorkflow: boolean; onOpen: () => void }) {
  const height = point.duration_s ? Math.max(2, (point.duration_s / max) * 100) : 2;
  return (
    <Tooltip
      delay={60}
      content={
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <StatusIcon state={point.state} className="size-3.5" />
            <span className="font-medium">#{point.run_number}</span>
            <span className="text-fg-muted">{stateLabel(point.state)}</span>
            <span className="ml-auto pl-3 font-medium tabular">{formatDuration(point.duration_s)}</span>
          </div>
          {point.title ? <div className="truncate text-fg-muted">{point.title}</div> : null}
          <div className="text-fg-subtle">
            {[showWorkflow ? point.workflow_name : null, point.branch, formatDate(point.created_at), point.attempt > 1 ? i18n.t("stats.attempt", { number: point.attempt }) : null].filter(Boolean).join(" · ")}
          </div>
        </div>
      }
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`#${point.run_number} · ${stateLabel(point.state)} · ${formatDuration(point.duration_s)}`}
        className="group relative flex h-full max-w-9 min-w-0 flex-1 items-end focus-visible:outline-none"
      >
        <span
          className="w-full rounded-t-[4px] transition-opacity group-hover:opacity-75 group-focus-visible:ring-2 group-focus-visible:ring-accent"
          style={{ height: `${height}%`, background: STATE_COLORS[point.state] }}
        />
      </button>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

function JobsTable({ jobs, showWorkflow }: { jobs: JobStats[]; showWorkflow: boolean }) {
  const [filter, setFilter] = useState<"all" | "unstable">("all");
  const unstable = jobs.filter((job) => job.unstable).length;
  const visible = useMemo(() => (filter === "unstable" ? jobs.filter((job) => job.unstable) : jobs), [jobs, filter]);
  const maxMedian = Math.max(1, ...jobs.map((job) => job.duration.median ?? 0));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-[13.5px] font-semibold">{i18n.t("stats.jobsTitle")}</h3>
        <SegmentedControl<"all" | "unstable">
          className="ml-auto"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: i18n.t("stats.allJobs"), count: jobs.length },
            { value: "unstable", label: i18n.t("stats.unstable"), count: unstable },
          ]}
        />
      </div>
      {jobs.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-fg-subtle">{i18n.t("stats.noJobs")}</p>
      ) : visible.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-fg-subtle">{i18n.t("stats.noUnstable")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-fg-subtle">
                <th className="px-4 py-2 font-medium">{i18n.t("stats.columns.job")}</th>
                <th className="px-3 py-2 font-medium">{i18n.t("stats.columns.success")}</th>
                <th className="px-3 py-2 font-medium">{i18n.t("stats.columns.median")}</th>
                <th className="px-3 py-2 text-right font-medium">{i18n.t("stats.columns.p90")}</th>
                <th className="px-4 py-2 font-medium">{i18n.t("stats.columns.history")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((job) => (
                <JobRow key={`${job.workflow_id}:${job.name}`} job={job} showWorkflow={showWorkflow} maxMedian={maxMedian} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function JobRow({ job, showWorkflow, maxMedian }: { job: JobStats; showWorkflow: boolean; maxMedian: number }) {
  const reasons = job.reasons.map((reason) => i18n.t(`stats.reasons.${reason}`, { count: reason === "retried" ? job.recoveries : job.flips })).join(" ");
  const rate = job.success_rate;
  return (
    <tr className="align-middle transition-colors hover:bg-surface-2/40">
      <td className="max-w-[280px] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{job.name}</span>
          {job.unstable ? (
            <Tooltip content={reasons}>
              <Badge className="shrink-0 border-running/30 bg-running/10 text-fg">
                <TriangleAlert className="text-running" /> {i18n.t("stats.unstable")}
              </Badge>
            </Tooltip>
          ) : null}
        </div>
        {showWorkflow || job.stage || job.allowed_failures ? (
          <div className="truncate text-[11.5px] text-fg-subtle">
            {[showWorkflow ? job.workflow_name : null, job.stage, job.allowed_failures ? i18n.t("stats.allowedShort", { count: job.allowed_failures }) : null].filter(Boolean).join(" · ")}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        <Tooltip
          content={[
            i18n.t("stats.jobCounts", { success: job.success, failure: job.failure }),
            job.allowed_failures ? i18n.t("stats.allowedFailures", { count: job.allowed_failures }) : null,
            job.skipped ? i18n.t("stats.skipped", { count: job.skipped }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <div className="flex w-32 items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full" style={{ width: `${(rate ?? 0) * 100}%`, background: rate === null ? "transparent" : rate >= 0.9 ? "var(--success)" : rate >= 0.7 ? "var(--running)" : "var(--failure)" }} />
            </div>
            <span className="w-10 text-right text-[12px] text-fg-muted tabular">{percent(rate)}</span>
          </div>
        </Tooltip>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex w-36 items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent/70" style={{ width: `${((job.duration.median ?? 0) / maxMedian) * 100}%` }} />
          </div>
          <span className="w-16 text-right text-[12px] text-fg-muted tabular">{formatDuration(job.duration.median)}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right text-[12px] text-fg-muted tabular">{formatDuration(job.duration.p90)}</td>
      <td className="px-4 py-2.5">
        <div className="flex h-4 items-end gap-[2px]" aria-label={i18n.t("states.history")}>
          {job.history.slice(-24).map((entry) => {
            const state = entry.outcome === "skipped" ? "skipped" : entry.outcome;
            return (
              <Tooltip
                key={entry.run_id}
                delay={60}
                content={
                  <span className="flex items-center gap-1.5">
                    <StatusIcon state={state} className="size-3.5" />#{entry.run_number} · {stateLabel(state)} · {formatDuration(entry.duration_s)}
                    {entry.attempts > 1 ? ` · ${i18n.t("stats.attempts", { count: entry.attempts })}` : ""}
                  </span>
                }
              >
                <span
                  className={cn("relative w-1.5 rounded-[2px]", entry.outcome === "failure" ? "h-4" : entry.outcome === "success" ? "h-2.5" : "h-1.5")}
                  style={{ background: STATE_COLORS[state] }}
                >
                  {entry.attempts > 1 ? <span className="absolute -top-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-running" /> : null}
                </span>
              </Tooltip>
            );
          })}
        </div>
      </td>
    </tr>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="px-4 py-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2.5 h-6 w-16" />
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="mt-4 h-40 w-full" />
      </Card>
    </div>
  );
}
