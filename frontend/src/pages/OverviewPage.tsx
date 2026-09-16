import { ArrowRight, CircleCheckBig, FolderGit2, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import i18n from "@/i18n";
import { RunDuration, RunRow, TimeAgo } from "@/components/runs";
import { isActive, StatusIcon } from "@/components/status";
import { buttonClass, Card, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useScans } from "@/hooks/scans";
import { useSession } from "@/hooks/session";
import { PROVIDER_LABELS, ProviderIcon, repoPath, runPath } from "@/lib/providers";
import type { Repository, Run, ScannedWorkflow } from "@/lib/types";
import { cn, firstLine, timeKey } from "@/lib/utils";

interface WorkflowWithRepo {
  repo: Repository;
  workflow: ScannedWorkflow;
  run: Run;
}

export function OverviewPage() {
  const { t } = useTranslation();
  const { entries, recentRuns, isLoadingRepos, scanned, total, reposErrors, accounts } = useScans();
  const { data: session } = useSession();

  const withCi = entries.filter((e) => e.scan?.has_ci);
  const latest: WorkflowWithRepo[] = withCi.flatMap((entry) =>
    entry.scan!.workflows.filter((wf) => wf.latest_run).map((wf) => ({ repo: entry.repo, workflow: wf, run: wf.latest_run! })),
  );
  const failing = latest.filter((item) => item.run.state === "failure").sort((a, b) => timeKey(b.run.created_at) - timeKey(a.run.created_at));
  const active = latest.filter((item) => isActive(item.run.state));
  const completed = recentRuns.filter((run) => run.state === "success" || run.state === "failure");
  const successRate = completed.length ? Math.round((completed.filter((run) => run.state === "success").length / completed.length) * 100) : null;
  const loading = isLoadingRepos || (total > 0 && scanned === 0);

  if (reposErrors.length && reposErrors.length === accounts.length) {
    return (
      <Page>
        <EmptyState icon={<Inbox />} title={t("overview.loadFailed")} description={reposErrors.map((e) => `${PROVIDER_LABELS[e.provider].label} : ${e.error.message}`).join(" · ")} />
      </Page>
    );
  }

  const firstName = session?.user?.name?.split(" ")[0];

  return (
    <Page>
      <div className="mb-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{greeting()}{firstName ? `, ${firstName}` : ""}</h1>
          <p className="mt-1 text-[13.5px] text-fg-muted">
            {loading
              ? t("overview.analyzing")
              : failing.length
                ? t("overview.failingSummary", { count: failing.length })
                : t("overview.allGreen")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label={t("overview.stats.withCi")} value={loading ? null : withCi.length} suffix={total ? `/ ${total}` : undefined} />
        <StatTile label={t("overview.stats.running")} value={loading ? null : active.length} state={active.length ? "running" : undefined} />
        <StatTile label={t("overview.stats.failing")} value={loading ? null : failing.length} state={failing.length ? "failure" : "success"} />
        <StatTile label={t("overview.stats.successRate")} value={loading ? null : successRate} suffix={successRate !== null ? "%" : undefined} hint={t("overview.stats.overRuns", { count: completed.length })} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Section title={t("overview.toFix")} count={failing.length}>
            {loading ? (
              <ListSkeleton rows={2} />
            ) : failing.length === 0 ? (
              <div className="flex items-center gap-3 px-4 py-5 text-[13px] text-fg-muted">
                <CircleCheckBig className="size-5 text-success" />
                {t("overview.noFailure")}
              </div>
            ) : (
              <div className="divide-y divide-line">
                {failing.map((item) => (
                  <FailureRow key={`${item.repo.key}-${item.workflow.id}`} item={item} />
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t("overview.recentActivity")}
            action={
              <Link to="/repos" className="flex items-center gap-1 text-[12.5px] font-medium text-fg-muted hover:text-fg">
                {t("overview.allRepositories")} <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            {loading ? (
              <ListSkeleton rows={5} />
            ) : recentRuns.length === 0 ? (
              <EmptyState
                icon={<FolderGit2 />}
                title={t("overview.noRuns")}
                description={t("overview.noRunsDescription")}
              />
            ) : (
              <div className="divide-y divide-line">
                {recentRuns.slice(0, 12).map((run) => (
                  <RunRow key={`${run.repoKey}-${run.id}`} run={run} provider={run.provider} fullName={run.repository} showRepo />
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title={t("overview.live")} count={active.length} live={active.length > 0}>
            {loading ? (
              <ListSkeleton rows={2} />
            ) : active.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-fg-muted">{t("overview.noActive")}</p>
            ) : (
              <div className="divide-y divide-line">
                {active.map((item) => (
                  <Link
                    key={`${item.repo.key}-${item.run.id}`}
                    to={runPath(item.repo.provider, item.repo.full_name, item.run.id)}
                    className="relative flex items-center gap-3 overflow-hidden px-4 py-3 transition-colors hover:bg-surface-2/60"
                  >
                    <StatusIcon state={item.run.state} className="size-[18px]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                        <ProviderIcon provider={item.repo.provider} className="size-3 shrink-0" />
                        {item.repo.name}
                      </div>
                      <div className="truncate text-[12px] text-fg-muted">{item.workflow.name}</div>
                    </div>
                    <RunDuration run={item.run} className="text-[12px] text-fg-muted" />
                    <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
                      <span className="block h-full w-1/3 animate-progress bg-gradient-to-r from-transparent via-running to-transparent" />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          <Section title={t("overview.health")}>
            {loading ? (
              <ListSkeleton rows={4} />
            ) : (
              <div className="p-2">
                {withCi
                  .slice()
                  .sort((a, b) => severity(a.scan!.state) - severity(b.scan!.state))
                  .slice(0, 8)
                  .map((entry) => (
                    <Link
                      key={entry.repo.key}
                      to={repoPath(entry.repo.provider, entry.repo.full_name)}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2/60"
                    >
                      <StatusIcon state={entry.scan!.state} className="size-3.5" />
                      <ProviderIcon provider={entry.repo.provider} className="size-3 shrink-0" mono />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{entry.repo.name}</span>
                      <span className="flex gap-[2px]">
                        {entry.scan!.workflows
                          .flatMap((wf) => wf.history)
                          .sort((a, b) => timeKey(a.created_at) - timeKey(b.created_at))
                          .slice(-10)
                          .map((h) => (
                            <span
                              key={h.id}
                              className="h-3 w-1 rounded-[1.5px]"
                              style={{ background: `var(--${h.state === "failure" ? "failure" : h.state === "success" ? "success" : h.state === "running" ? "running" : "queued"})` }}
                            />
                          ))}
                      </span>
                    </Link>
                  ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </Page>
  );
}

function greeting() {
  const hour = new Date().getHours();
  return i18n.t(hour < 5 ? "overview.greeting.night" : hour < 12 ? "overview.greeting.morning" : hour < 18 ? "overview.greeting.afternoon" : "overview.greeting.evening");
}

function severity(state: string) {
  return ["failure", "running", "queued", "action_required", "cancelled", "success"].indexOf(state) + 1 || 99;
}

function FailureRow({ item }: { item: WorkflowWithRepo }) {
  return (
    <div className="group flex items-center gap-3.5 px-4 py-3.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-failure/10">
        <StatusIcon state="failure" className="size-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13.5px]">
          <ProviderIcon provider={item.repo.provider} className="size-3.5 shrink-0" />
          <Link to={repoPath(item.repo.provider, item.repo.full_name)} className="truncate font-medium hover:underline">
            {item.repo.name}
          </Link>
          <span className="text-fg-subtle">·</span>
          <span className="truncate text-fg-muted">{item.workflow.name}</span>
        </div>
        <div className="mt-0.5 truncate text-[12.5px] text-fg-subtle">
          {firstLine(item.run.commit_message)} · {item.run.branch} · <TimeAgo date={item.run.created_at} />
        </div>
      </div>
      <Link to={runPath(item.repo.provider, item.repo.full_name, item.run.id)} className={buttonClass("secondary", "sm")}>
        {i18n.t("overview.viewError")}
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1320px] px-8 py-7 animate-fade-in", className)}>{children}</div>;
}

function StatTile({
  label,
  value,
  suffix,
  hint,
  state,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  hint?: string;
  state?: "running" | "failure" | "success";
}) {
  return (
    <Card className="relative overflow-hidden px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        {state ? <StatusIcon state={state} className="size-3.5" /> : null}
        {label}
      </div>
      {value === null ? (
        <Skeleton className="mt-2.5 h-7 w-16" />
      ) : (
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[28px] leading-tight font-semibold tracking-tight">{value}</span>
          {suffix ? <span className="text-[14px] text-fg-subtle">{suffix}</span> : null}
        </div>
      )}
      {hint && value !== null ? <div className="text-[11.5px] text-fg-subtle">{hint}</div> : null}
    </Card>
  );
}

export function Section({
  title,
  count,
  action,
  live,
  children,
  className,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  live?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        {count ? <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-medium text-fg-muted tabular">{count}</span> : null}
        {live ? (
          <span className="relative ml-0.5 inline-flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-running opacity-60" />
            <span className="relative size-2 rounded-full bg-running" />
          </span>
        ) : null}
        <div className="ml-auto">{action}</div>
      </div>
      <Card className="overflow-hidden">{children}</Card>
    </section>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3.5 px-4 py-3.5">
          <Skeleton className="size-[18px] rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
