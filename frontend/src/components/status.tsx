import { Link } from "react-router";
import { runPath } from "@/lib/providers";
import type { HistoryEntry, ProviderId, RunStateName } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { Tooltip } from "./ui/overlays";

export const STATE_LABELS: Record<RunStateName, string> = {
  success: "Réussi",
  failure: "Échec",
  running: "En cours",
  queued: "En attente",
  cancelled: "Annulé",
  skipped: "Ignoré",
  action_required: "Action requise",
  neutral: "Neutre",
  none: "Pas de CI",
};

export const STATE_COLORS: Record<RunStateName, string> = {
  success: "var(--success)",
  failure: "var(--failure)",
  running: "var(--running)",
  queued: "var(--queued)",
  cancelled: "var(--cancelled)",
  skipped: "var(--cancelled)",
  action_required: "var(--running)",
  neutral: "var(--cancelled)",
  none: "var(--fg-subtle)",
};

export function isActive(state: RunStateName | undefined | null) {
  return state === "running" || state === "queued";
}

/** Icône de statut dessinée à la main : nette à toutes les tailles, forme distincte pour chaque état. */
export function StatusIcon({ state, className }: { state: RunStateName; className?: string }) {
  const color = STATE_COLORS[state];
  const common = { viewBox: "0 0 16 16", className: cn("size-4 shrink-0", className), "aria-label": STATE_LABELS[state], role: "img" as const };

  switch (state) {
    case "success":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="m5 8.2 2 2 4-4.2" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "failure":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "running":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="2" />
          <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" className="origin-center animate-spin" />
          <circle cx="8" cy="8" r="2" fill={color} />
        </svg>
      );
    case "queued":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.8" strokeDasharray="2.4 2.3" />
        </svg>
      );
    case "action_required":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="M8 4.5v4" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="11.2" r="1" fill="white" />
        </svg>
      );
    case "cancelled":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.8" />
          <path d="m4 12 8-8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "skipped":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.8" />
          <path d="M5.5 8h5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.8" strokeOpacity={state === "none" ? 0.5 : 1} />
        </svg>
      );
  }
}

export function StatusBadge({ state, className, size = "md" }: { state: RunStateName; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium text-fg",
        size === "sm" && "h-5 pr-2 pl-0.5 text-[11.5px]",
        size === "md" && "h-6 pr-2.5 pl-1 text-[12px]",
        size === "lg" && "h-7 pr-3 pl-1.5 text-[13px]",
        className,
      )}
      style={{ background: `color-mix(in oklab, ${STATE_COLORS[state]} 13%, transparent)` }}
    >
      <StatusIcon state={state} className={size === "lg" ? "size-4.5" : size === "sm" ? "size-3.5" : "size-4"} />
      {STATE_LABELS[state]}
    </span>
  );
}

/** Historique des dernières exécutions, du plus ancien (gauche) au plus récent (droite). */
export function HistoryStrip({
  history,
  provider,
  fullName,
  slots = 12,
  className,
}: {
  history: HistoryEntry[];
  provider: ProviderId;
  fullName: string;
  slots?: number;
  className?: string;
}) {
  const padding = Math.max(0, slots - history.length);
  return (
    <div className={cn("flex h-5 items-end gap-[2px]", className)} aria-label="Historique des exécutions">
      {Array.from({ length: padding }).map((_, i) => (
        <span key={`pad-${i}`} className="h-1.5 w-1.5 rounded-[2px] bg-surface-3" />
      ))}
      {history.map((entry, index) => {
        const last = index === history.length - 1;
        return (
          <Tooltip
            key={entry.id}
            delay={80}
            content={
              <span className="flex items-center gap-1.5">
                <StatusIcon state={entry.state} className="size-3.5" />
                <span className="font-medium">#{entry.run_number}</span>
                <span className="text-fg-muted">{STATE_LABELS[entry.state]} · {timeAgo(entry.created_at)}</span>
              </span>
            }
          >
            <Link
              to={runPath(provider, fullName, entry.id)}
              onClick={(event) => event.stopPropagation()}
              className={cn(
                "w-1.5 rounded-[2px] transition-[height,opacity] duration-150 hover:opacity-80",
                entry.state === "failure" ? "h-5" : last ? "h-4" : "h-3",
                isActive(entry.state) && "animate-pulse",
              )}
              style={{ background: STATE_COLORS[entry.state] }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2", className)}>
      <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-success" />
    </span>
  );
}
