import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  CircleStop,
  Cpu,
  ExternalLink,
  FileWarning,
  GitCommitHorizontal,
  Info,
  RotateCcw,
  ScrollText,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import i18n from "@/i18n";
import { LogViewer, plainText, type LogViewerHandle } from "@/components/LogViewer";
import { BranchChip, EventIcon, MetaItem, RunDuration, TimeAgo } from "@/components/runs";
import { isActive, STATE_COLORS, stateLabel, StatusBadge, StatusIcon } from "@/components/status";
import { Menu, MenuContent, MenuItem, MenuTrigger, Tooltip } from "@/components/ui/overlays";
import { Avatar, Badge, Button, Card, EmptyState, Skeleton, Spinner } from "@/components/ui/primitives";
import { useNow } from "@/hooks/useNow";
import { api, ApiError, type RepoRef } from "@/lib/api";
import { PROVIDER_LABELS, ProviderIcon, repoKey, repoPath, runPath, useRepoRef } from "@/lib/providers";
import type { Annotation, Capabilities, Job, JobLog, Run } from "@/lib/types";
import { cn, elapsedSeconds, eventLabel, firstLine, formatDuration, shortSha } from "@/lib/utils";
import { Page } from "./OverviewPage";

export function RunPage() {
  const repoRef = useRepoRef();
  const key = repoKey(repoRef.provider, repoRef.full_name);
  const { runId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [boostUntil, setBoostUntil] = useState(0);
  const logRef = useRef<LogViewerHandle>(null);
  const pendingJump = useRef<{ line?: number; group?: string } | null>(null);

  const runQuery = useQuery({
    queryKey: ["run", key, runId],
    queryFn: () => api.getRun(repoRef, runId),
    refetchInterval: (query) => {
      const state = query.state.data?.run.state;
      if (isActive(state)) return 3_000;
      return Date.now() < boostUntil ? 2_000 : false;
    },
  });

  const run = runQuery.data?.run;
  const capabilities = runQuery.data?.capabilities;
  const jobs = useMemo(() => runQuery.data?.jobs ?? [], [runQuery.data]);

  // Notification lorsque l'exécution se termine pendant qu'on la regarde.
  const previousState = useRef(run?.state);
  useEffect(() => {
    if (!run) return;
    const previous = previousState.current;
    previousState.current = run.state;
    if (previous && isActive(previous) && !isActive(run.state)) {
      void queryClient.invalidateQueries({ queryKey: ["scan", key] });
      const notify = run.state === "success" ? toast.success : run.state === "failure" ? toast.error : toast;
      notify(`${run.name} #${run.run_number} : ${stateLabel(run.state)}`, { description: firstLine(run.commit_message) });
    }
  }, [run, key, queryClient]);

  // Sans choix explicite : le job en échec, sinon celui qui tourne, sinon le dernier suivi.
  const lastSelectedId = useRef<string | null>(null);
  const selectedJob = useMemo(() => {
    const fromUrl = jobs.find((job) => job.id === params.get("job"));
    return (
      fromUrl ??
      jobs.find((j) => j.state === "failure") ??
      jobs.find((j) => isActive(j.state) && j.started_at) ??
      jobs.find((j) => j.id === lastSelectedId.current) ??
      jobs[0]
    );
  }, [jobs, params]);
  useEffect(() => {
    if (selectedJob) lastSelectedId.current = selectedJob.id;
  }, [selectedJob]);

  const selectJob = (job: Job, jump?: { line?: number; group?: string }) => {
    pendingJump.current = jump ?? null;
    setParams({ job: job.id }, { replace: true });
  };

  const failedJobs = jobs.filter((job) => job.state === "failure");

  if (runQuery.error) {
    return (
      <Page>
        <Card>
          <EmptyState icon={<TriangleAlert />} title={i18n.t("run.notFound")} description={runQuery.error.message} />
        </Card>
      </Page>
    );
  }

  if (!run || !capabilities) return <RunSkeleton />;

  return (
    <Page className="flex h-full max-w-none flex-col px-6 py-5">
      <RunHeader run={run} repoRef={repoRef} jobs={jobs} capabilities={capabilities} onAction={() => setBoostUntil(Date.now() + 30_000)} />

      {failedJobs.length > 0 ? (
        <ErrorSummary
          repoRef={repoRef}
          jobs={failedJobs}
          capabilities={capabilities}
          onOpen={(job, line) => {
            if (selectedJob?.id === job.id && line !== undefined) logRef.current?.jumpToLine(line);
            else selectJob(job, { line });
          }}
        />
      ) : null}

      <div className="mt-4 grid min-h-[480px] flex-1 grid-cols-[280px_minmax(0,1fr)] gap-4">
        <JobsPanel
          jobs={jobs}
          selected={selectedJob}
          onSelect={selectJob}
          onStepClick={(job, step) => {
            if (selectedJob?.id === job.id) logRef.current?.jumpToGroup(step);
            else selectJob(job, { group: step });
          }}
        />
        <Card className="flex min-h-0 flex-col overflow-hidden">
          {selectedJob ? (
            <JobPanel
              key={selectedJob.id}
              repoRef={repoRef}
              job={selectedJob}
              capabilities={capabilities}
              logRef={logRef}
              onLogReady={() => {
                const jump = pendingJump.current;
                pendingJump.current = null;
                if (jump?.line !== undefined) logRef.current?.jumpToLine(jump.line);
                else if (jump?.group) logRef.current?.jumpToGroup(jump.group);
              }}
            />
          ) : (
            <EmptyState icon={<Spinner />} title={i18n.t("run.waitingJobs")} description={i18n.t("run.waitingJobsDescription")} />
          )}
        </Card>
      </div>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* En-tête                                                                    */
/* -------------------------------------------------------------------------- */

function RunHeader({
  run,
  repoRef,
  jobs,
  capabilities,
  onAction,
}: {
  run: Run;
  repoRef: RepoRef;
  jobs: Job[];
  capabilities: Capabilities;
  onAction: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const active = isActive(run.state);
  const done = jobs.filter((job) => !isActive(job.state)).length;
  const key = repoKey(repoRef.provider, repoRef.full_name);
  const providerLabel = PROVIDER_LABELS[repoRef.provider].label;

  const perform = async (action: string, task: () => Promise<{ run_id: string } | null>, success: string) => {
    setBusy(action);
    try {
      const result = await task();
      toast.success(success);
      onAction();
      void queryClient.invalidateQueries({ queryKey: ["scan", key] });
      if (result?.run_id && result.run_id !== run.id) {
        // GitLab / Bitbucket : un nouveau pipeline a été créé, on le suit directement.
        navigate(runPath(repoRef.provider, repoRef.full_name, result.run_id));
      } else {
        await queryClient.invalidateQueries({ queryKey: ["run", key] });
      }
    } catch (error) {
      toast.error(i18n.t("common.actionFailed"), { description: error instanceof ApiError ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const canRerunFailed = capabilities.rerun_failed && (run.state === "failure" || run.state === "cancelled");

  return (
    <div className="relative shrink-0">
      <div className="flex items-start gap-4">
        <div
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: `color-mix(in oklab, ${STATE_COLORS[run.state]} 14%, transparent)` }}
        >
          <StatusIcon state={run.state} className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">
            <ProviderIcon provider={repoRef.provider} className="size-3.5" />
            <Link to={repoPath(repoRef.provider, repoRef.full_name, `?tab=runs&workflow=${encodeURIComponent(run.workflow_id)}`)} className="font-medium hover:text-fg hover:underline">
              {run.name}
            </Link>
            <span className="text-fg-subtle">#{run.run_number}</span>
            {run.run_attempt > 1 ? <Badge>{i18n.t("run.attempt", { attempt: run.run_attempt })}</Badge> : null}
            <StatusBadge state={run.state} size="sm" />
          </div>
          <h1 className="mt-1 truncate text-[20px] font-semibold tracking-tight">{firstLine(run.commit_message) || run.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
            {run.actor?.login ? (
              <MetaItem>
                <Avatar login={run.actor.login} src={run.actor.avatar_url} size={18} />
                <span className="text-fg">{run.actor.login}</span>
              </MetaItem>
            ) : null}
            <MetaItem icon={<EventIcon event={run.event} />}>{eventLabel(run.event)}</MetaItem>
            <BranchChip branch={run.branch} />
            <MetaItem icon={<GitCommitHorizontal />} className="font-mono text-[12px]">
              {shortSha(run.head_sha)}
            </MetaItem>
            <MetaItem>
              {i18n.t("run.started")} <TimeAgo date={run.started_at ?? run.created_at} />
            </MetaItem>
            <RunDuration run={run} className="text-fg-muted" />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {active ? (
            capabilities.cancel ? (
              <Button variant="danger" onClick={() => void perform("cancel", () => api.cancelRun(repoRef, run.id), i18n.t("run.cancelRequested"))} loading={busy === "cancel"}>
                <CircleStop /> {i18n.t("common.cancel")}
              </Button>
            ) : null
          ) : capabilities.rerun_all || canRerunFailed ? (
            <Menu>
              <MenuTrigger asChild>
                <Button variant={run.state === "failure" ? "primary" : "secondary"} loading={busy === "rerun"}>
                  <RotateCcw /> {i18n.t("run.rerun")} <ChevronDown className="-mr-1 opacity-70" />
                </Button>
              </MenuTrigger>
              <MenuContent>
                {canRerunFailed ? (
                  <MenuItem
                    icon={<RotateCcw />}
                    description={i18n.t("run.rerunFailedDescription")}
                    onSelect={() => void perform("rerun", () => api.rerunRun(repoRef, run.id, true), i18n.t("run.rerunFailedRequested"))}
                  >
                    {i18n.t("run.rerunFailed")}
                  </MenuItem>
                ) : null}
                {capabilities.rerun_all ? (
                  <MenuItem
                    icon={<RotateCcw />}
                    description={capabilities.rerun_all_description}
                    onSelect={() => void perform("rerun", () => api.rerunRun(repoRef, run.id, false), i18n.t("run.rerunRequested"))}
                  >
                    {capabilities.rerun_all_label}
                  </MenuItem>
                ) : null}
              </MenuContent>
            </Menu>
          ) : null}
          <Tooltip content={i18n.t("common.openOn", { provider: providerLabel })}>
            <Button variant="secondary" size="icon" onClick={() => void api.openExternal(run.html_url)} aria-label={i18n.t("common.openOn", { provider: providerLabel })}>
              <ExternalLink />
            </Button>
          </Tooltip>
        </div>
      </div>

      {active && jobs.length ? (
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="relative h-full rounded-full bg-running transition-[width] duration-700" style={{ width: `${Math.max(4, (done / jobs.length) * 100)}%` }} />
          </div>
          <span className="text-[12px] text-fg-muted tabular">
            {i18n.t("run.jobsDone", { done, total: jobs.length })}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Résumé des erreurs                                                         */
/* -------------------------------------------------------------------------- */

function ErrorSummary({
  repoRef,
  jobs,
  capabilities,
  onOpen,
}: {
  repoRef: RepoRef;
  jobs: Job[];
  capabilities: Capabilities;
  onOpen: (job: Job, line?: number) => void;
}) {
  const key = repoKey(repoRef.provider, repoRef.full_name);
  const annotationQueries = useQueries({
    queries: jobs.map((job) => ({
      queryKey: ["annotations", key, job.id],
      queryFn: () => api.getJobAnnotations(repoRef, job.id),
      staleTime: Number.POSITIVE_INFINITY,
      enabled: capabilities.annotations,
    })),
  });
  const logQueries = useQueries({
    queries: jobs.map((job) => ({
      queryKey: ["log", key, job.id],
      queryFn: () => api.getJobLog(repoRef, job.id),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });

  return (
    <Card className="mt-5 shrink-0 overflow-hidden border-failure/25 animate-fade-in">
      <div className="flex items-center gap-2.5 border-b border-failure/15 bg-failure/[0.06] px-4 py-2.5">
        <FileWarning className="size-4 text-failure" />
        <h2 className="text-[13.5px] font-semibold">{i18n.t("run.failedJobs", { count: jobs.length })}</h2>
        <span className="text-[12.5px] text-fg-muted">— {i18n.t("run.whatWentWrong")}</span>
      </div>
      <div className="divide-y divide-line">
        {jobs.map((job, index) => {
          const allAnnotations = (annotationQueries[index]?.data ?? []).filter((a) => a.level !== "notice");
          // Le « exit code 1 » générique n'apporte rien s'il y a des annotations plus précises.
          const specific = allAnnotations.filter((a) => !/^Process completed with exit code/.test(a.message));
          const annotations = specific.length ? specific : allAnnotations;
          const log = logQueries[index]?.data;
          const excerpt = log?.available ? log.excerpts[0] : undefined;
          return (
            <div key={job.id} className="grid gap-4 px-4 py-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusIcon state="failure" className="size-3.5" />
                  <span className="truncate text-[13.5px] font-semibold">{job.name}</span>
                  {job.stage ? <Badge>{job.stage}</Badge> : null}
                  {job.conclusion === "timed_out" ? <Badge>{i18n.t("run.timedOut")}</Badge> : null}
                </div>
                <ul className="mt-2 space-y-1.5">
                  {capabilities.annotations && annotationQueries[index]?.isPending ? (
                    <Skeleton className="h-4 w-3/4" />
                  ) : annotations.length ? (
                    annotations.slice(0, 4).map((annotation, i) => <AnnotationItem key={i} annotation={annotation} />)
                  ) : (
                    <li className="text-[12.5px] text-fg-muted">
                      {excerpt?.inferred
                        ? i18n.t("run.noExplicitError")
                        : i18n.t("run.noAnnotation")}
                    </li>
                  )}
                </ul>
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => onOpen(job, excerpt?.line)}>
                  <ScrollText className="size-3.5" /> {i18n.t("run.viewInLogs")}
                </Button>
              </div>
              <LogExcerpt log={log} loading={logQueries[index]?.isPending} onLineClick={(line) => onOpen(job, line)} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AnnotationItem({ annotation }: { annotation: Annotation }) {
  const location = annotation.path && annotation.path !== ".github" ? `${annotation.path}${annotation.start_line ? `:${annotation.start_line}` : ""}` : null;
  return (
    <li className="flex items-start gap-2 text-[12.5px]">
      <TriangleAlert className={cn("mt-0.5 size-3.5 shrink-0", annotation.level === "warning" ? "text-running" : "text-failure")} />
      <div className="min-w-0">
        {annotation.title ? <div className="font-medium">{annotation.title}</div> : null}
        <div className="break-words whitespace-pre-line text-fg-muted">{annotation.message}</div>
        {location ? <div className="mt-0.5 font-mono text-[11.5px] text-fg-subtle">{location}</div> : null}
      </div>
    </li>
  );
}

function LogExcerpt({ log, loading, onLineClick }: { log: JobLog | undefined; loading?: boolean; onLineClick: (line: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // L'erreur est en bas de l'extrait : on l'affiche en priorité.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [log]);

  if (loading) return <Skeleton className="h-28 w-full rounded-lg" />;
  if (!log?.available || !log.excerpts.length) return null;
  const excerpt = log.excerpts[0];
  const start = Math.max(excerpt.start, excerpt.end - 14);
  const lines = log.lines.slice(start, excerpt.end + 1);
  return (
    <div ref={scrollRef} className="scrollbar-thin max-h-48 overflow-auto rounded-lg border border-line bg-log py-1.5 font-mono text-[11.5px] leading-[18px]">
      {lines.map((line, i) => {
        const index = start + i;
        return (
          <button
            key={index}
            onClick={() => onLineClick(index)}
            className={cn(
              "flex w-full text-left hover:bg-surface-2",
              line.kind === "error" ? "bg-failure/10 text-failure" : line.hint ? "text-fg" : "text-fg-muted",
            )}
          >
            <span className="w-10 shrink-0 pr-2 text-right text-fg-subtle/70 select-none">{index + 1}</span>
            <span className="pr-3 break-all whitespace-pre-wrap">{plainText(line) || " "}</span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Jobs & étapes                                                              */
/* -------------------------------------------------------------------------- */

function JobsPanel({
  jobs,
  selected,
  onSelect,
  onStepClick,
}: {
  jobs: Job[];
  selected: Job | undefined;
  onSelect: (job: Job) => void;
  onStepClick: (job: Job, stepName: string) => void;
}) {
  // GitLab : jobs regroupés par stage, dans l'ordre d'apparition.
  const groups = useMemo(() => {
    if (!jobs.some((job) => job.stage)) return [{ stage: null as string | null, jobs }];
    const byStage = new Map<string, Job[]>();
    for (const job of jobs) {
      const stage = job.stage ?? "—";
      byStage.set(stage, [...(byStage.get(stage) ?? []), job]);
    }
    return [...byStage.entries()].map(([stage, stageJobs]) => ({ stage, jobs: stageJobs }));
  }, [jobs]);

  return (
    <Card className="scrollbar-thin flex min-h-0 flex-col overflow-y-auto p-1.5">
      {jobs.length === 0 ? <div className="px-2.5 py-2 text-[12.5px] text-fg-muted">{i18n.t("run.noJobs")}</div> : null}
      {groups.map((group, groupIndex) => (
        <div key={group.stage ?? "jobs"} className={cn(groupIndex > 0 && "mt-2")}>
          <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-1.5 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
            {group.stage ? (
              <>
                <StageState jobs={group.jobs} />
                <span className="truncate">{group.stage}</span>
              </>
            ) : (
              "Jobs"
            )}
          </div>
          {group.jobs.map((job) => {
            const isSelected = selected?.id === job.id;
            return (
              <div key={job.id} className="mb-0.5">
                <button
                  onClick={() => onSelect(job)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    isSelected ? "bg-surface-2 ring-1 ring-line ring-inset" : "hover:bg-surface-2/60",
                  )}
                >
                  <StatusIcon state={job.allow_failure ? "action_required" : job.state} />
                  <span className={cn("min-w-0 flex-1 truncate text-[13px]", isSelected ? "font-semibold" : "font-medium")}>{job.name}</span>
                  {job.allow_failure ? (
                    <Tooltip content={i18n.t("run.allowFailureTooltip")}>
                      <Badge className="border-running/30 bg-running/10 text-fg">{i18n.t("run.allowed")}</Badge>
                    </Tooltip>
                  ) : null}
                  <JobDuration job={job} />
                </button>
                {isSelected && job.steps.length ? (
                  <div className="relative mt-1 mb-2 ml-[18px] border-l border-line pl-3">
                    {job.steps.map((step) => (
                      <button
                        key={step.number}
                        onClick={() => onStepClick(job, step.name)}
                        className="group flex w-full items-center gap-2 rounded-md py-1 pr-2 pl-1 text-left hover:bg-surface-2/60"
                      >
                        <StatusIcon state={step.state} className="size-3.5" />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-[12.5px]",
                            step.state === "skipped" || step.state === "queued" ? "text-fg-subtle" : "text-fg-muted group-hover:text-fg",
                          )}
                        >
                          {step.name}
                        </span>
                        <StepDuration started={step.started_at} completed={step.completed_at} active={step.state === "running"} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </Card>
  );
}

function StageState({ jobs }: { jobs: Job[] }) {
  const states = jobs.map((job) => (job.allow_failure ? "success" : job.state));
  const state = states.includes("failure")
    ? "failure"
    : states.includes("running")
      ? "running"
      : states.includes("queued")
        ? "queued"
        : states.every((s) => s === "skipped")
          ? "skipped"
          : states.includes("cancelled")
            ? "cancelled"
            : "success";
  return <StatusIcon state={state} className="size-3" />;
}

function JobDuration({ job }: { job: Job }) {
  const now = useNow();
  if (job.state === "queued") return <span className="shrink-0 text-[11.5px] text-fg-subtle">{i18n.t("run.queuedShort")}</span>;
  if (job.state === "skipped") return null;
  const seconds = job.state === "running" ? elapsedSeconds(job.started_at, null, now) : job.duration_s;
  return <span className="shrink-0 text-[11.5px] text-fg-subtle tabular">{formatDuration(seconds)}</span>;
}

function StepDuration({ started, completed, active }: { started: string | null; completed: string | null; active: boolean }) {
  const now = useNow();
  if (!started) return null;
  const seconds = elapsedSeconds(started, active ? null : completed, now);
  return <span className="shrink-0 text-[11px] text-fg-subtle tabular">{formatDuration(seconds)}</span>;
}

/* -------------------------------------------------------------------------- */
/* Panneau du job sélectionné                                                 */
/* -------------------------------------------------------------------------- */

function JobPanel({
  repoRef,
  job,
  capabilities,
  logRef,
  onLogReady,
}: {
  repoRef: RepoRef;
  job: Job;
  capabilities: Capabilities;
  logRef: React.RefObject<LogViewerHandle | null>;
  onLogReady: () => void;
}) {
  const providerLabel = PROVIDER_LABELS[repoRef.provider].label;
  const started = Boolean(job.started_at);
  const finished = !isActive(job.state) && started;
  // GitHub ne publie le log qu'à la fin du job ; GitLab et Bitbucket le diffusent pendant l'exécution.
  const logsEnabled = finished || (capabilities.live_logs && started);

  const logQuery = useQuery({
    queryKey: ["log", repoKey(repoRef.provider, repoRef.full_name), job.id],
    queryFn: () => api.getJobLog(repoRef, job.id),
    enabled: logsEnabled,
    staleTime: (query) => (query.state.data?.available && query.state.data.complete ? Number.POSITIVE_INFINITY : 0),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      // Log pas encore publié, ou log en direct : on interroge régulièrement.
      if (!data.available || !data.complete) return 3_000;
      return false;
    },
  });

  const log = logQuery.data;
  const firstLoad = useRef(true);
  useEffect(() => {
    if (log?.available && firstLoad.current) {
      firstLoad.current = false;
      requestAnimationFrame(onLogReady);
    }
  }, [log]);

  const header = (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3">
      <StatusIcon state={job.allow_failure ? "action_required" : job.state} />
      <span className="text-[14px] font-semibold">{job.name}</span>
      {job.stage ? <Badge>{job.stage}</Badge> : null}
      {job.labels.length ? (
        <MetaItem icon={<Cpu />} className="text-[12px]">
          {job.labels.join(", ")}
        </MetaItem>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <JobDuration job={job} />
        <Tooltip content={i18n.t("run.viewJobOn", { provider: providerLabel })}>
          <Button variant="ghost" size="icon-sm" onClick={() => void api.openExternal(job.html_url)} aria-label={i18n.t("run.viewJobOn", { provider: providerLabel })}>
            <ExternalLink />
          </Button>
        </Tooltip>
      </div>
    </div>
  );

  if (job.state === "skipped" || (job.state === "cancelled" && !started)) {
    return (
      <>
        {header}
        <EmptyState
          icon={<Info />}
          title={job.state === "skipped" ? i18n.t("run.jobSkipped") : i18n.t("run.jobCancelled")}
          description={
            job.state === "skipped"
              ? i18n.t("run.jobSkippedDescription")
              : i18n.t("run.jobCancelledDescription")
          }
        />
      </>
    );
  }

  if (!logsEnabled) {
    return (
      <>
        {header}
        <LiveSteps job={job} providerLabel={providerLabel} />
      </>
    );
  }

  return (
    <>
      {header}
      {logQuery.isPending || (log && !log.available) ? (
        job.steps.length && !finished ? (
          <LiveSteps job={job} providerLabel={providerLabel} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-fg-muted">
            <Spinner />
            {log && !log.available ? i18n.t("run.logPublishing", { provider: providerLabel }) : i18n.t("run.logLoading")}
          </div>
        )
      ) : logQuery.error ? (
        <EmptyState icon={<TriangleAlert />} title={i18n.t("run.logUnavailable")} description={logQuery.error.message} />
      ) : log?.available ? (
        <LogViewer ref={logRef} log={log} className="flex-1" />
      ) : null}
    </>
  );
}

function LiveSteps({ job, providerLabel }: { job: Job; providerLabel: string }) {
  const now = useNow();
  const done = job.steps.filter((s) => s.status === "completed").length;
  const current = job.steps.find((s) => s.state === "running");

  if (job.state === "queued" || !job.started_at) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <StatusIcon state="queued" className="size-8" />
        <div className="text-[14px] font-semibold">{i18n.t("run.waitingRunner")}</div>
        <p className="max-w-sm text-[13px] text-fg-muted">{i18n.t("run.waitingRunnerDescription")}</p>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center gap-4">
          <div className="flex-1">
            <div className="text-[13px] font-medium">{current ? current.name : i18n.t("run.preparing")}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-running transition-[width] duration-700" style={{ width: `${Math.max(3, (done / Math.max(1, job.steps.length)) * 100)}%` }} />
            </div>
          </div>
          <span className="text-[12.5px] text-fg-muted tabular">
            {i18n.t("run.stepsDone", { done, total: job.steps.length })}
          </span>
        </div>

        <ol className="relative space-y-1">
          {job.steps.map((step) => {
            const running = step.state === "running";
            return (
              <li key={step.number} className={cn("flex items-center gap-3 rounded-xl px-3.5 py-2.5 transition-colors", running ? "bg-running/10 ring-1 ring-running/25 ring-inset" : "")}>
                <StatusIcon state={step.state} />
                <span className={cn("min-w-0 flex-1 truncate text-[13px]", step.state === "queued" ? "text-fg-subtle" : running ? "font-medium" : "text-fg-muted")}>
                  {step.name}
                </span>
                {step.started_at ? (
                  <span className="text-[12px] text-fg-subtle tabular">{formatDuration(elapsedSeconds(step.started_at, running ? null : step.completed_at, now))}</span>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-line bg-surface-2/50 p-3.5 text-[12.5px] text-fg-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" />
          <p>{i18n.t("run.liveStepsHint", { provider: providerLabel })}</p>
        </div>
      </div>
    </div>
  );
}

function RunSkeleton() {
  return (
    <Page className="max-w-none px-6 py-5">
      <div className="flex items-start gap-4">
        <Skeleton className="size-12 rounded-2xl" />
        <div className="flex-1 space-y-2.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-6 w-2/5" />
          <Skeleton className="h-3.5 w-3/5" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-[280px_minmax(0,1fr)] gap-4">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </Page>
  );
}
