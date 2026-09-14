import i18n, { currentLanguage } from "@/i18n";
import type {
  Annotation,
  BranchSuggestion,
  CiFileContent,
  Publication,
  PullRequest,
  ValidationResult,
  WorkflowSummary,
  GeneratedPipeline,
  UpdateCheck,
  PipelineOptions,
  ProjectAnalysis,
  LocalCiDiff,
  LocalOverview,
  LocalStatus,
  SyncResult,
  ProviderId,
  JobLog,
  RateLimit,
  RepoScan,
  Repository,
  RunDetail,
  RunsPage,
  Session,
  Settings,
  WorkflowFile,
} from "./types";

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; reset_at?: number } };
type Transport = (method: string, params?: Record<string, unknown>) => Promise<Envelope<unknown>>;

/** Langue transmise au moteur à chaque appel : ses messages (erreurs, validation, génération) suivent l'interface. */
const language = () => currentLanguage();

declare global {
  interface Window {
    pywebview?: { api?: { call?: (method: string, params?: Record<string, unknown>, language?: string) => Promise<Envelope<unknown>> } };
  }
}

export class ApiError extends Error {
  readonly code: string;
  readonly resetAt?: number;

  constructor(code: string, message: string, resetAt?: number) {
    super(message);
    this.code = code;
    this.resetAt = resetAt;
  }
}

const bridgeTransport: Transport = (method, params) => window.pywebview!.api!.call!(method, params ?? {}, language());

const httpTransport: Transport = async (method, params) => {
  const response = await fetch("/api/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params: params ?? {}, language: language() }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

/**
 * Deux modes : dans l'app desktop, le pont pywebview ; dans un navigateur (développement),
 * le serveur HTTP local. Le pont est injecté de façon asynchrone, on attend donc le premier
 * des deux disponibles.
 */
let transportPromise: Promise<Transport> | null = null;

function resolveTransport(): Promise<Transport> {
  if (transportPromise) return transportPromise;
  transportPromise = new Promise<Transport>((resolve, reject) => {
    if (window.pywebview?.api?.call) return resolve(bridgeTransport);
    let settled = false;
    const done = (transport: Transport) => {
      if (settled) return;
      settled = true;
      resolve(transport);
    };
    window.addEventListener("pywebviewready", () => done(bridgeTransport), { once: true });

    // On laisse une courte avance au pont desktop avant de tenter le serveur HTTP.
    setTimeout(() => {
      httpTransport("ping")
        .then((envelope) => envelope.ok && done(httpTransport))
        .catch(() => undefined);
    }, 250);

    setTimeout(() => {
      if (!settled) {
        transportPromise = null;
        reject(new ApiError("backend_unavailable", i18n.t("errors.backendUnavailable")));
      }
    }, 10_000);
  });
  return transportPromise;
}

async function call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const transport = await resolveTransport();
  let envelope: Envelope<unknown>;
  try {
    envelope = await transport(method, params);
  } catch (error) {
    throw new ApiError("backend_unavailable", i18n.t("errors.backendCommunication", { error: String(error) }));
  }
  if (!envelope.ok) throw new ApiError(envelope.error.code, envelope.error.message, envelope.error.reset_at);
  return envelope.data as T;
}

export const api = {
  getSession: () => call<Session>("get_session"),
  connectAccount: (provider: ProviderId, credentials: Record<string, string>) => call<Session>("connect_account", { provider, credentials }),
  disconnectAccount: (provider: ProviderId) => call<Session>("disconnect_account", { provider }),
  loginWithGhCli: () => call<Session>("login_with_gh_cli"),
  startDemo: () => call<Session>("start_demo"),
  logout: () => call<Session>("logout"),

  getSettings: () => call<Settings>("get_settings"),
  updateSettings: (changes: Partial<Settings>) => call<Settings>("update_settings", { changes }),
  openExternal: (url: string) => call<boolean>("open_external", { url }),
  getRateLimits: () => call<RateLimit[]>("get_rate_limits"),
  checkForUpdate: (force = false) => call<UpdateCheck>("check_for_update", { force }),

  listRepositories: (provider: ProviderId) => call<Repository[]>("list_repositories", { provider }),
  addRepository: (reference: string, provider?: ProviderId) =>
    call<{ repository: Repository; settings: Settings }>("add_repository", { reference, provider }),
  removeRepository: (key: string) => call<Settings>("remove_repository", { key }),

  scanRepository: (ref: RepoRef) => call<RepoScan>("scan_repository", ref),
  getRepository: (ref: RepoRef) => call<Repository>("get_repository", ref),
  listRuns: (ref: RepoRef, options: { workflow_id?: string; branch?: string; status?: string; page?: number } = {}) =>
    call<RunsPage>("list_runs", { ...ref, ...options }),
  getRun: (ref: RepoRef, runId: string) => call<RunDetail>("get_run", { ...ref, run_id: runId }),
  getJobLog: (ref: RepoRef, jobId: string) => call<JobLog>("get_job_log", { ...ref, job_id: jobId }),
  getJobAnnotations: (ref: RepoRef, jobId: string) => call<Annotation[]>("get_job_annotations", { ...ref, job_id: jobId }),
  getWorkflowFile: (ref: RepoRef, path: string, gitRef?: string) => call<WorkflowFile>("get_workflow_file", { ...ref, path, ref: gitRef }),
  rerunRun: (ref: RepoRef, runId: string, failedOnly = false) =>
    call<{ run_id: string } | null>("rerun_run", { ...ref, run_id: runId, failed_only: failedOnly }),
  cancelRun: (ref: RepoRef, runId: string) => call<null>("cancel_run", { ...ref, run_id: runId }),

  // Projets locaux
  localOverview: () => call<LocalOverview>("local_overview"),
  scanLocalProjects: () => call<LocalOverview>("scan_local_projects"),
  addLocalRoot: (path: string) => call<LocalOverview>("add_local_root", { path }),
  removeLocalRoot: (path: string) => call<LocalOverview>("remove_local_root", { path }),
  pickFolder: (title: string) => call<string | null>("pick_folder", { title }),
  linkLocalProject: (key: string, path: string, force = false) => call<LocalStatus>("link_local_project", { key, path, force }),
  unlinkLocalProject: (key: string) => call<LocalOverview>("unlink_local_project", { key }),
  cloneRepository: (key: string, parent: string, protocol: "https" | "ssh") => call<LocalStatus>("clone_repository", { key, parent, protocol }),
  getLocalStatus: (key: string) => call<LocalStatus>("get_local_status", { key }),
  syncLocalProject: (key: string, pull = false) => call<SyncResult>("sync_local_project", { key, pull }),
  getLocalCiDiff: (key: string, path: string) => call<LocalCiDiff>("get_local_ci_diff", { key, path }),
  openLocalProject: (key: string, target: "folder" | "editor" | "terminal", editorId?: string | null) =>
    call<null>("open_local_project", { key, target, editor_id: editorId ?? null }),

  // Édition des fichiers CI (dans le clone local)
  validateCi: (provider: ProviderId, content: string) => call<ValidationResult>("validate_ci", { provider, content }),
  summarizeCi: (provider: ProviderId, content: string) => call<WorkflowSummary>("summarize_ci", { provider, content }),
  lintCiRemote: (key: string, content: string) => call<{ valid: boolean; errors: string[]; warnings: string[] }>("lint_ci_remote", { key, content }),
  readCiFile: (key: string, path: string) => call<CiFileContent>("read_ci_file", { key, path }),
  saveCiFile: (key: string, path: string, content: string, expectedHash: string | null, overwrite = false) =>
    call<{ hash: string; status: LocalStatus }>("save_ci_file", { key, path, content, expected_hash: expectedHash, overwrite }),
  discardCiFile: (key: string, path: string) => call<LocalStatus>("discard_ci_file", { key, path }),
  branchSuggestion: (key: string, path?: string) => call<BranchSuggestion>("branch_suggestion", { key, path }),
  commitCi: (key: string, paths: string[], message: string, newBranch: string | null) =>
    call<{ sha: string; status: LocalStatus }>("commit_ci", { key, paths, message, new_branch: newBranch }),
  pushLocalBranch: (key: string) => call<{ remote: string; branch: string; status: LocalStatus }>("push_local_branch", { key }),
  getPublication: (key: string) => call<Publication>("get_publication", { key }),
  createPullRequest: (key: string, title: string, body: string, base: string | null, draft: boolean) =>
    call<PullRequest>("create_pull_request", { key, title, body, base, draft }),

  // Génération de pipelines (modèles, sans IA)
  detectProject: (key: string) => call<ProjectAnalysis>("detect_project", { key }),
  generatePipeline: (key: string, options: PipelineOptions) => call<GeneratedPipeline>("generate_pipeline", { key, options }),
};

/** Désigne un dépôt auprès du moteur : fournisseur + chemin complet. */
export type RepoRef = {
  provider: ProviderId;
  full_name: string;
};
