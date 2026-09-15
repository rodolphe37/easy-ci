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
  system_language: "fr" | "en";
}

export interface Settings {
  theme: "system" | "light" | "dark";
  language: "system" | "fr" | "en";
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
  check_updates: boolean;
  dismissed_update_version: string | null;
  notifications_enabled: boolean;
  notify_failures: boolean;
  notify_recoveries: boolean;
  notifications_scope: "all" | "favorites";
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

export type JobChange = "broken" | "still_failing" | "fixed" | "added" | "removed" | "changed" | "slower" | "faster" | "unchanged";

export interface JobComparisonSide {
  id: string;
  state: RunStateName;
  outcome: "success" | "failure" | "cancelled" | "skipped" | "allowed_failure";
  allow_failure: boolean;
  duration_s: number | null;
  /** GitHub : première étape en échec. */
  failed_step: string | null;
}

export interface JobComparison {
  name: string;
  stage: string | null;
  change: JobChange;
  base: JobComparisonSide | null;
  head: JobComparisonSide | null;
  duration_delta_s: number | null;
  duration_change: number | null;
}

export interface CompareCommit {
  sha: string;
  title: string;
  message: string;
  author: { name: string | null; login: string | null; avatar_url: string | null };
  date: string | null;
  html_url: string | null;
}

export interface CompareFile {
  path: string;
  previous_path: string | null;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number | null;
  deletions: number | null;
  /** Fichier de configuration CI (workflow, .gitlab-ci.yml…). */
  ci_config: boolean;
}

export interface CommitRange {
  /** « behind » : l'exécution comparée porte sur un commit plus ancien que la référence. */
  status: "ahead" | "behind" | "diverged" | "identical";
  ahead_by: number | null;
  behind_by: number | null;
  /** null : total inconnu (liste incomplète). */
  total_commits: number | null;
  commits: CompareCommit[];
  commits_truncated: boolean;
  files: CompareFile[];
  files_total: number | null;
  files_truncated: boolean;
  html_url: string | null;
  ci_config_changed: boolean;
}

export interface RunComparisonSummary extends Record<JobChange, number> {
  same_commit: boolean;
  same_branch: boolean;
  duration_delta_s: number | null;
  duration_change: number | null;
}

export interface RunComparison {
  head: Run;
  base: Run | null;
  /** Comment la référence a été choisie. */
  baseline: "same_branch" | "default_branch" | "manual" | null;
  summary: RunComparisonSummary | null;
  jobs: JobComparison[];
  commits: CommitRange | null;
  commits_error: string | null;
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

/* -------------------------------------------------------------------------- */
/* Génération de pipelines                                                    */
/* -------------------------------------------------------------------------- */

export type PipelineStep = "lint" | "typecheck" | "test" | "build";
export type DeliveryWhen = "default_branch" | "tags" | "both";

export interface DetectedStack {
  id: string;
  label: string;
  directory: string;
  framework: string | null;
  version: string | null;
  version_source: string | null;
  package_manager: string | null;
  workspace: boolean;
  commands: Record<PipelineStep | "install", string | null>;
  evidence: string[];
}

export interface ProjectDetection {
  stacks: DetectedStack[];
  docker: { dockerfile: string; context: string; compose: boolean } | null;
  deploy_hints: { id: string; label: string; file: string }[];
  existing_ci: string[];
}

export interface StackOptions {
  id: string;
  directory: string;
  enabled: boolean;
  version: string;
  package_manager: string | null;
  matrix: string[];
  install: string;
  steps: Record<PipelineStep, { enabled: boolean; command: string }>;
}

export interface PipelineOptions {
  path: string;
  name: string;
  stacks: StackOptions[];
  triggers: { push_default: boolean; pull_requests: boolean; tags: boolean; schedule: string; manual: boolean };
  default_branch: string;
  cache: boolean;
  concurrency: boolean;
  os: string[];
  docker: { enabled: boolean; dockerfile: string; context: string; push: boolean; registry: string; image: string; when: DeliveryWhen };
  deploy: { enabled: boolean; environment: string; command: string; secrets: string[]; use_stack: boolean; manual: boolean; when: DeliveryWhen };
}

export interface PipelineChoices {
  paths: string[];
  path_editable: boolean;
  os: { id: string; label: string }[];
  registries: { id: string; label: string }[];
  supports: { concurrency: boolean; os_matrix: boolean; schedule_in_file: boolean };
  step_labels: Record<PipelineStep, string>;
  stack_labels: Record<string, string>;
}

export interface ProjectAnalysis {
  provider: ProviderId;
  detection: ProjectDetection;
  options: PipelineOptions;
  choices: PipelineChoices;
}

export interface GeneratedPipeline {
  path: string;
  content: string;
  validation: ValidationResult;
  summary: WorkflowSummary;
  notes: string[];
  exists: boolean;
  existing_hash: string | null;
  branch: string | null;
}

/* -------------------------------------------------------------------------- */
/* Mises à jour de l'application                                              */
/* -------------------------------------------------------------------------- */

export type InstallMethod = "homebrew" | "script" | "manual" | "source";

export interface UpdateCheck {
  current_version: string;
  checked_at: number;
  available: boolean;
  latest: { version: string; url: string; published_at: string | null; notes: string } | null;
  error: string | null;
  releases_url: string;
  install_method: InstallMethod;
  instructions: { label: string; command: string }[];
}

/* -------------------------------------------------------------------------- */
/* Notifications système                                                      */
/* -------------------------------------------------------------------------- */

export type NotificationMethod = "osascript" | "windows" | "notify-send" | "gdbus";

export interface NotificationSupport {
  supported: boolean;
  method: NotificationMethod | null;
}

export interface NotificationResult {
  delivered: boolean;
  method: NotificationMethod | null;
  reason: "unsupported" | "failed" | null;
  error: string | null;
}

/* -------------------------------------------------------------------------- */
/* Statistiques des exécutions                                                */
/* -------------------------------------------------------------------------- */

export interface DurationSummary {
  median: number | null;
  p90: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
}

export interface StatsRunPoint {
  id: string;
  run_number: number;
  state: "success" | "failure" | "cancelled";
  created_at: string;
  duration_s: number | null;
  branch: string | null;
  title: string | null;
  attempt: number;
  workflow_id: string;
  workflow_name: string | null;
}

export type JobOutcome = "success" | "failure" | "cancelled" | "skipped";

export interface JobStats {
  name: string;
  stage: string | null;
  workflow_id: string;
  workflow_name: string | null;
  runs: number;
  success: number;
  failure: number;
  allowed_failures: number;
  skipped: number;
  success_rate: number | null;
  duration: DurationSummary;
  flips: number;
  flip_rate: number;
  recoveries: number;
  unstable: boolean;
  reasons: ("retried" | "alternating")[];
  history: { run_id: string; run_number: number; created_at: string; outcome: JobOutcome; duration_s: number | null; attempts: number }[];
}

export interface RunStats {
  runs_analyzed: number;
  jobs_analyzed: number;
  limit: number;
  workflow_id: string | null;
  branch: string | null;
  incomplete_runs: number;
  total_runs: number | null;
  summary: {
    success: number;
    failure: number;
    cancelled: number;
    success_rate: number | null;
    duration: DurationSummary;
    trend: { previous_median: number | null; recent_median: number | null; change: number | null } | null;
    first_run_at: string | null;
    last_run_at: string | null;
  };
  runs: StatsRunPoint[];
  jobs: JobStats[];
  unstable_jobs: number;
}
