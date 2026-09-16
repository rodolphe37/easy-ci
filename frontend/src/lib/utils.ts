import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import i18n, { currentLanguage } from "@/i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Formats localisés : recréés seulement quand la langue change.
let formatters: { language: string; relative: Intl.RelativeTimeFormat; date: Intl.DateTimeFormat; number: Intl.NumberFormat } | null = null;

function intl() {
  const language = currentLanguage();
  if (formatters?.language !== language) {
    const locale = language === "fr" ? "fr-FR" : "en-US";
    formatters = {
      language,
      relative: new Intl.RelativeTimeFormat(language, { numeric: "auto", style: "short" }),
      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
      number: new Intl.NumberFormat(locale),
    };
  }
  return formatters;
}

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
  if (duration > -10 && duration < 60) return i18n.t("time.justNow");
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return intl().relative.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return "—";
}

/**
 * Instant d'un horodatage ISO, pour comparer deux dates. Comparer les chaînes directement est
 * faux dès que le décalage horaire change : GitLab auto-hébergé renvoie l'heure locale de
 * l'instance, décalage compris. Une date absente ou illisible passe en premier.
 */
export function timeKey(date: string | null | undefined): number {
  if (!date) return -Infinity;
  const value = Date.parse(date);
  return Number.isNaN(value) ? -Infinity : value;
}

export function formatDate(date: string | null | undefined): string {
  return date ? intl().date.format(new Date(date)) : "—";
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
  return intl().number.format(value);
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "";
}

export function firstLine(text: string | null | undefined): string {
  return (text ?? "").split("\n", 1)[0];
}

const EVENT_KEYS = {
  push: "push",
  pull_request: "pullRequest",
  pull_request_target: "pullRequest",
  merge_request: "mergeRequest",
  schedule: "schedule",
  workflow_dispatch: "manual",
  manual: "manual",
  release: "release",
  tag: "tag",
  merge_group: "mergeQueue",
  workflow_run: "workflow",
  pipeline: "parentPipeline",
  trigger: "trigger",
  api: "api",
  dynamic: "dynamic",
} as const;

export function eventLabel(event: string | null | undefined): string {
  if (!event) return "—";
  const key = EVENT_KEYS[event as keyof typeof EVENT_KEYS];
  return key ? i18n.t(`events.${key}`) : event;
}

export function initials(login: string | null | undefined): string {
  return (login ?? "?").replace(/\[bot\]$/, "").slice(0, 2).toUpperCase();
}
