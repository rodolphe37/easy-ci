import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const relativeFormatter = new Intl.RelativeTimeFormat("fr", { numeric: "auto", style: "short" });
const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const numberFormatter = new Intl.NumberFormat("fr-FR");

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

export function timeAgo(date: string | null | undefined, now = Date.now()): string {
  if (!date) return "—";
  let duration = (new Date(date).getTime() - now) / 1000;
  // Une date légèrement dans le futur vient d'un décalage d'horloge : on la considère comme récente.
  if (duration > -10 && duration < 60) return "à l'instant";
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return relativeFormatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return "—";
}

export function formatDate(date: string | null | undefined): string {
  return date ? dateFormatter.format(new Date(date)) : "—";
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

export function elapsedSeconds(start: string | null | undefined, end?: string | null, now = Date.now()): number | null {
  if (!start) return null;
  const endTime = end ? new Date(end).getTime() : now;
  return (endTime - new Date(start).getTime()) / 1000;
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "";
}

export function firstLine(text: string | null | undefined): string {
  return (text ?? "").split("\n", 1)[0];
}

const EVENT_LABELS: Record<string, string> = {
  push: "Push",
  pull_request: "Pull request",
  pull_request_target: "Pull request",
  merge_request: "Merge request",
  schedule: "Planifié",
  workflow_dispatch: "Manuel",
  manual: "Manuel",
  release: "Release",
  tag: "Tag",
  merge_group: "Merge queue",
  workflow_run: "Workflow",
  pipeline: "Pipeline parent",
  trigger: "Déclencheur",
  api: "API",
  dynamic: "Automatique",
};

export function eventLabel(event: string | null | undefined): string {
  return event ? (EVENT_LABELS[event] ?? event) : "—";
}

export function initials(login: string | null | undefined): string {
  return (login ?? "?").replace(/\[bot\]$/, "").slice(0, 2).toUpperCase();
}
