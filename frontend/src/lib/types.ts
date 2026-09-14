export type RunStateName =
  | "success"
  | "failure"
  | "running"
  | "queued"
  | "cancelled"
  | "skipped"
  | "action_required"
  | "neutral"
  | "none";

export type ProviderId = "github" | "gitlab" | "bitbucket";

export interface Capabilities {
  rerun_failed: boolean;
  rerun_all: boolean;
  rerun_all_label: string;
  rerun_all_description: string;
  cancel: boolean;
  live_logs: boolean;
  annotations: boolean;
  steps: boolean;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  ci_label: string;
  workflow_label: string;
  run_label: string;
  config_hint: string;
  default_host: string;
  token_url: string;
  capabilities: Capabilities;
}

export interface Account {
  provider: ProviderId;
  user: User;
  persisted: boolean;
  host: string;
}

export interface User {
  login: string;
  name: string;
  avatar_url: string | null;
  html_url: string | null;
}

export interface Session {
  authenticated: boolean;
  mode: "live" | "demo" | null;
  accounts: Account[];
  user: User | null;
  restore_errors: { provider: ProviderId; message: string }[];
  gh_cli_available: boolean;
  providers: Record<ProviderId, ProviderInfo>;
  app_version: string;
}

export interface Settings {
  theme: "system" | "light" | "dark";
  refresh_interval: number;
  favorites: string[];
  added_repositories: string[];
  hidden_repositories: string[];
  show_repos_without_ci: boolean;
  include_archived: boolean;
  local_roots: string[];
  local_links: Record<string, string>;
  auto_fetch_minutes: number;
  auto_pull: boolean;
  preferred_editor: string | null;
}

export interface Repository {
  id: string;
  provider: ProviderId;
  /** « fournisseur:chemin », identifiant unique tous fournisseurs confondus. */
  key: string;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  default_branch: string;
  html_url: string;
  pushed_at: string | null;
  ci_config_path: string | null;
  added_manually?: boolean;
}

export interface Actor {
  login: string;
  avatar_url: string | null;
}

export interface Run {
  id: string;
  name: string | null;
  title: string;
  commit_message: string;
  workflow_id: string;
  run_number: number;
  run_attempt: number;
  event: string;
  status: string;
  conclusion: string | null;
  state: RunStateName;
  branch: string | null;
  head_sha: string;
  actor: Actor | null;
  created_at: string;
  started_at: string | null;
  updated_at: string | null;
  duration_s: number | null;
  html_url: string;
  repository: string | null;
}

export interface HistoryEntry {
  id: string;
  run_number: number;
  state: RunStateName;
  created_at: string;
}

export interface Workflow {
  id: string;
  name: string;
  path: string;
  state: string;
  html_url: string | null;
  dynamic: boolean;
}

export interface ScannedWorkflow extends Workflow {
  latest_run: Run | null;
  history: HistoryEntry[];
}

export interface RepoScan {
  full_name: string;
  has_ci: boolean;
  state: RunStateName;
  workflows: ScannedWorkflow[];
  recent_runs: Run[];
  last_run: Run | null;
  scanned_at: string;
}

export interface Step {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
  state: RunStateName;
  started_at: string | null;
  completed_at: string | null;
  duration_s: number | null;
}

export interface Job {
  id: string;
  name: string;
  /** Stage GitLab (null ailleurs). */
  stage: string | null;
  /** GitLab : échec autorisé, non bloquant. */
  allow_failure: boolean;
  status: string;
  conclusion: string | null;
  state: RunStateName;
  started_at: string | null;
  completed_at: string | null;
  duration_s: number | null;
  runner_name: string | null;
  labels: string[];
  html_url: string;
  steps: Step[];
}

export interface RunDetail {
  run: Run;
  jobs: Job[];
  capabilities: Capabilities;
}

export interface RunsPage {
  runs: Run[];
  total_count: number;
  page: number;
  has_more: boolean;
}

export interface LogSegment {
  t: string;
  fg?: string;
  bg?: string;
  b?: boolean;
  d?: boolean;
  i?: boolean;
  u?: boolean;
}

export type LogLineKind = "output" | "group" | "error" | "warning" | "notice" | "debug" | "command";

export interface LogLine {
  kind: LogLineKind;
  segments: LogSegment[];
  ts?: string;
  group?: number;
  header?: number;
  hint?: boolean;
}

export interface LogGroup {
  id: number;
  title: string;
  line: number;
  end: number;
  has_error: boolean;
  has_warning: boolean;
  collapsed: boolean;
}

export interface LogExcerpt {
  line: number;
  message: string;
  start: number;
  end: number;
  /** Aucune ligne d'erreur explicite : extrait déduit de la fin du log. */
  inferred?: boolean;
}

export type JobLog =
  | { available: false }
  | {
      available: true;
      /** false tant que le job tourne (logs en direct GitLab / Bitbucket). */
      complete: boolean;
      lines: LogLine[];
      groups: LogGroup[];
      errors: number[];
      warnings: number[];
      excerpts: LogExcerpt[];
      truncated: boolean;
      line_count: number;
    };

export interface Annotation {
  path: string | null;
  start_line: number | null;
  end_line: number | null;
  level: "failure" | "warning" | "notice";
  title: string | null;
  message: string;
}

export interface WorkflowSummary {
  valid: boolean;
  error: string | null;
  error_line: number | null;
  name?: string | null;
  triggers: { event: string; details: string[] }[];
  stages: string[];
  includes: string[];
  jobs: {
    id: string;
    name: string;
    stage: string | null;
    runs_on: string | null;
    needs: string[];
    steps: number;
    uses: string | null;
    matrix: boolean;
  }[];
}

export interface WorkflowFile {
  path: string;
  sha: string;
  html_url: string;
  content: string;
  summary: WorkflowSummary;
}

export interface RateLimit {
  provider: ProviderId;
  limit: number;
  remaining: number;
  reset_at: number;
}

/* -------------------------------------------------------------------------- */
/* Projets locaux                                                             */
/* -------------------------------------------------------------------------- */

export interface LocalRoot {
  path: string;
  display_path: string;
  exists: boolean;
}

export interface LocalProject {
  key: string;
  path: string;
  display_path: string;
  source: "scan" | "manual";
  exists: boolean;
  candidates: string[];
}

export interface LocalOverview {
  git_version: string | null;
  roots: LocalRoot[];
  projects: LocalProject[];
  unmatched: { path: string; display_path: string; remotes: string[] }[];
  scanned_at: number | null;
  scanning: boolean;
  picker_available: boolean;
  editors: { id: string; label: string }[];
  file_manager: string;
  demo?: boolean;
}

export type CiFileState = "synced" | "uncommitted" | "untracked" | "unpushed" | "outdated" | "diverged";

export interface LocalCiFile {
  path: string;
  state: CiFileState;
  local: boolean;
  remote: boolean;
}

export type LocalStatus =
  | { key: string; linked: false }
  | {
      key: string;
      linked: true;
      path: string;
      display_path: string;
      exists: boolean;
      error: string | null;
      branch?: string | null;
      detached?: boolean;
      upstream?: string | null;
      ahead?: number;
      behind?: number;
      dirty?: boolean;
      changes?: { path: string; status: string }[];
      changes_count?: number;
      last_commit?: { sha: string; message: string; author: string; date: string } | null;
      last_fetch_at?: number | null;
      remote_matches?: boolean;
      remotes?: { name: string; url: string }[];
      compare_ref?: string | null;
      ci_files?: LocalCiFile[];
    };

export interface SyncResult {
  pulled: boolean;
  skipped_reason: "no_upstream" | "dirty" | "up_to_date" | "diverged" | null;
  status: LocalStatus;
}

export interface LocalCiDiff {
  path: string;
  compare_ref: string | null;
  local: string | null;
  remote: string | null;
  diff: string;
}

/* -------------------------------------------------------------------------- */
/* Édition des fichiers CI                                                    */
/* -------------------------------------------------------------------------- */

export interface ValidationProblem {
  severity: "error" | "warning";
  message: string;
  line: number | null;
  column: number | null;
  path: string | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: number;
  warnings: number;
  problems: ValidationProblem[];
}

export interface CiFileContent {
  path: string;
  exists: boolean;
  content: string;
  hash: string | null;
  tracked: boolean;
  branch: string | null;
  detached: boolean;
}

export interface BranchSuggestion {
  suggested: string;
  current: string | null;
  default_branch: string | null;
  on_default_branch: boolean;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: string;
  draft: boolean;
  source_branch: string | null;
  target_branch: string | null;
  label: string;
  already_existed?: boolean;
}

export interface Publication {
  available: boolean;
  branch?: string | null;
  upstream?: string | null;
  ahead?: number;
  pushed?: boolean;
  pull_request?: PullRequest | null;
  default_branch?: string | null;
  account_connected?: boolean;
  pull_request_error?: string | null;
}
