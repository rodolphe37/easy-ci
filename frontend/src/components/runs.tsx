import { CalendarClock, GitBranch, GitCommitHorizontal, GitPullRequest, Hand, Tag, Timer, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useNow } from "@/hooks/useNow";
import { ProviderIcon, runPath } from "@/lib/providers";
import type { ProviderId, Run } from "@/lib/types";
import { cn, elapsedSeconds, eventLabel, formatDate, formatDuration, shortSha, timeAgo } from "@/lib/utils";
import { isActive, stateLabel, StatusIcon } from "./status";
import { Tooltip } from "./ui/overlays";
import { Avatar } from "./ui/primitives";

export function EventIcon({ event, className }: { event: string | null; className?: string }) {
  const props = { className: cn("size-3.5", className) };
  switch (event) {
    case "pull_request":
    case "pull_request_target":
    case "merge_request":
      return <GitPullRequest {...props} />;
    case "schedule":
      return <CalendarClock {...props} />;
    case "workflow_dispatch":
    case "manual":
      return <Hand {...props} />;
    case "release":
    case "tag":
      return <Tag {...props} />;
    default:
      return <Upload {...props} />;
  }
}

/** Durée d'une exécution : fixe si terminée, compteur en direct sinon. */
export function RunDuration({ run, className }: { run: Pick<Run, "state" | "started_at" | "duration_s" | "updated_at">; className?: string }) {
  const now = useNow();
  const active = isActive(run.state);
  const seconds = active ? (run.state === "queued" ? null : elapsedSeconds(run.started_at, null, now)) : run.duration_s;
  return (
    <span className={cn("inline-flex items-center gap-1 tabular", active && "text-fg", className)}>
      <Timer className="size-3.5 text-fg-subtle" />
      {run.state === "queued" ? stateLabel("queued") : formatDuration(seconds)}
    </span>
  );
}

export function TimeAgo({ date, className }: { date: string | null | undefined; className?: string }) {
  const now = useNow();
  return (
    <Tooltip content={date ? formatDate(date) : null}>
      <span className={cn("tabular whitespace-nowrap", className)}>{timeAgo(date, now)}</span>
    </Tooltip>
  );
}

export function MetaItem({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-fg-muted [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-subtle", className)}>
      {icon}
      {children}
    </span>
  );
}

export function BranchChip({ branch }: { branch: string | null }) {
  if (!branch) return null;
  return (
    <span className="inline-flex h-5 max-w-44 items-center gap-1 rounded-md bg-surface-2 px-1.5 font-mono text-[11.5px] text-fg-muted ring-1 ring-line ring-inset">
      <GitBranch className="size-3 shrink-0 text-fg-subtle" />
      <span className="truncate">{branch}</span>
    </span>
  );
}

/** Ligne d'exécution compacte, utilisée dans les listes d'activité et d'historique. */
export function RunRow({
  run,
  provider,
  fullName,
  showRepo = false,
  showWorkflow = true,
}: {
  run: Run;
  provider: ProviderId;
  fullName: string;
  showRepo?: boolean;
  showWorkflow?: boolean;
}) {
  const active = isActive(run.state);
  return (
    <Link
      to={runPath(provider, fullName, run.id)}
      className="group relative flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-surface-2/60"
    >
      <StatusIcon state={run.state} className="size-[18px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-fg">{run.title || run.name}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-x-3 gap-y-1 text-[12px]">
          {showRepo ? (
            <span className="inline-flex min-w-0 items-center gap-1 font-medium text-fg-muted">
              <ProviderIcon provider={provider} className="size-3 shrink-0" />
              <span className="truncate">{fullName.split("/").pop()}</span>
            </span>
          ) : null}
          {showWorkflow ? (
            <MetaItem>
              <span className="truncate">
                {run.name} <span className="text-fg-subtle">#{run.run_number}</span>
              </span>
            </MetaItem>
          ) : (
            <MetaItem>
              <span className="text-fg-subtle">#{run.run_number}</span>
            </MetaItem>
          )}
          <MetaItem icon={<EventIcon event={run.event} />}>{eventLabel(run.event)}</MetaItem>
          <BranchChip branch={run.branch} />
          <MetaItem icon={<GitCommitHorizontal />} className="hidden font-mono text-[11.5px] xl:inline-flex">
            {shortSha(run.head_sha)}
          </MetaItem>
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-2 text-[12px] text-fg-muted lg:flex">
        <Avatar login={run.actor?.login} src={run.actor?.avatar_url} size={18} />
        <span className="max-w-28 truncate">{run.actor?.login}</span>
      </div>
      <div className="flex w-32 shrink-0 flex-col items-end gap-0.5 text-[12px] text-fg-muted">
        <TimeAgo date={run.created_at} />
        <RunDuration run={run} className="text-fg-subtle" />
      </div>
      {active ? (
        <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <span className="block h-full w-1/3 animate-progress bg-gradient-to-r from-transparent via-running to-transparent" />
        </span>
      ) : null}
    </Link>
  );
}
