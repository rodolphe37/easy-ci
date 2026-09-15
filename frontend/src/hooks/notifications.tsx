import { useEffect, useRef } from "react";
import { toast } from "sonner";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { runPath } from "@/lib/providers";
import type { NotificationResult, RepoScan, Repository, Run, Settings } from "@/lib/types";
import { firstLine } from "@/lib/utils";
import { useScans } from "./scans";
import { useSettings } from "./session";

type Outcome = "success" | "failure";

interface Seen {
  runId: string;
  token: string;
  createdAt: string;
  /** Dernier résultat décisif (succès ou échec) : une annulation ne change pas l'état du pipeline. */
  outcome: Outcome | null;
}

export interface PipelineEvent {
  kind: "failed" | "recovered";
  repo: Repository;
  workflowName: string;
  runId: string;
  run: Run | null;
}

/** Au-delà, un seul message résume les changements détectés lors d'une même actualisation. */
const GROUP_THRESHOLD = 3;

/**
 * Compare le dernier scan de chaque workflow à l'état mémorisé et renvoie les changements :
 * passage en échec (depuis un succès ou un état inconnu) et retour au vert (après un échec).
 * Le premier scan sert de référence : rien n'est signalé au démarrage.
 */
export function detectPipelineEvents(seen: Map<string, Seen>, repo: Repository, scan: RepoScan): PipelineEvent[] {
  const events: PipelineEvent[] = [];
  for (const workflow of scan.workflows) {
    if (workflow.state !== "active") continue;
    // Historique du plus ancien au plus récent : dernière exécution terminée.
    const done = [...workflow.history].reverse().find((entry) => entry.state === "success" || entry.state === "failure" || entry.state === "cancelled");
    if (!done) continue;
    const run = scan.recent_runs.find((item) => item.id === done.id) ?? (workflow.latest_run?.id === done.id ? workflow.latest_run : null);
    const key = `${repo.key}#${workflow.id}`;
    // Une relance GitHub garde le même identifiant : la tentative et l'état distinguent les résultats.
    const token = `${done.id}:${run?.run_attempt ?? 1}:${done.state}`;
    const previous = seen.get(key);
    const outcome: Outcome | null = done.state === "cancelled" ? null : (done.state as Outcome);

    if (!previous) {
      seen.set(key, { runId: done.id, token, createdAt: done.created_at, outcome });
      continue;
    }
    // Rien de nouveau, ou une exécution plus ancienne que la référence (relance d'une vieille exécution en cours).
    if (previous.token === token || done.created_at < previous.createdAt) continue;

    seen.set(key, { runId: done.id, token, createdAt: done.created_at, outcome: outcome ?? previous.outcome });
    if (outcome === "failure" && previous.outcome !== "failure") {
      events.push({ kind: "failed", repo, workflowName: workflow.name, runId: done.id, run });
    } else if (outcome === "success" && previous.outcome === "failure") {
      events.push({ kind: "recovered", repo, workflowName: workflow.name, runId: done.id, run });
    }
  }
  return events;
}

function eventTexts(event: PipelineEvent) {
  const title = i18n.t(`notifications.${event.kind}.title`, { workflow: event.workflowName, repo: event.repo.full_name });
  const parts = [event.run?.branch, firstLine(event.run?.commit_message) || event.run?.title, event.run ? `#${event.run.run_number}` : null];
  return { title, body: parts.filter(Boolean).join(" · ") };
}

function wantsEvent(settings: Settings | undefined, event: PipelineEvent) {
  if (!settings?.notifications_enabled) return false;
  if (event.kind === "failed" && !settings.notify_failures) return false;
  if (event.kind === "recovered" && !settings.notify_recoveries) return false;
  if (settings.notifications_scope === "favorites") return settings.favorites.some((key) => key.toLowerCase() === event.repo.key.toLowerCase());
  return true;
}

/** Notification web (navigateur, démo en ligne) quand le système n'en propose pas. */
function webNotification(title: string, body: string): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  new Notification(title, { body, icon: "favicon.png" });
  return true;
}

/** Notification système via le moteur, avec repli sur l'API web. */
export async function sendSystemNotification(title: string, body: string): Promise<NotificationResult> {
  try {
    const result = await api.notify(title, body);
    if (!result.delivered && result.reason === "unsupported" && webNotification(title, body)) {
      return { delivered: true, method: null, reason: null, error: null };
    }
    return result;
  } catch (error) {
    return { delivered: false, method: null, reason: "failed", error: String(error) };
  }
}

/**
 * Surveille les scans et signale les pipelines qui échouent ou repassent au vert :
 * notification dans l'application, et notification système quand la fenêtre n'a pas le focus.
 */
export function RunNotifications() {
  const { entries } = useScans();
  const { settings } = useSettings();
  const seen = useRef(new Map<string, Seen>());
  const scannedAt = useRef(new Map<string, string>());

  useEffect(() => {
    const events: PipelineEvent[] = [];
    for (const entry of entries) {
      const scan = entry.scan;
      if (!scan?.has_ci || scannedAt.current.get(entry.repo.key) === scan.scanned_at) continue;
      scannedAt.current.set(entry.repo.key, scan.scanned_at);
      events.push(...detectPipelineEvents(seen.current, entry.repo, scan));
    }
    const wanted = events.filter((event) => wantsEvent(settings, event));
    if (!wanted.length) return;

    const background = !document.hasFocus();
    if (wanted.length > GROUP_THRESHOLD) {
      const failed = wanted.filter((event) => event.kind === "failed").length;
      const title = i18n.t("notifications.grouped.title", { count: wanted.length });
      const body = i18n.t("notifications.grouped.body", { failed, recovered: wanted.length - failed });
      toast(title, { description: body });
      if (background) void sendSystemNotification(title, body);
      return;
    }
    for (const event of wanted) {
      const { title, body } = eventTexts(event);
      const open = { label: i18n.t("notifications.open"), onClick: () => (window.location.hash = runPath(event.repo.provider, event.repo.full_name, event.runId)) };
      if (event.kind === "failed") toast.error(title, { description: body, action: open, duration: 10_000 });
      else toast.success(title, { description: body, action: open });
      if (background) void sendSystemNotification(title, body);
    }
    // L'état mémorisé repart de zéro quand l'application change de mode (démo, comptes réels) : AuthenticatedApp est recréée.
  }, [entries, settings]);

  return null;
}
