import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  FileCode2,
  GitBranch,
  History,
  Layers,
  Laptop,
  Lock,
  Pencil,
  RefreshCw,
  Star,
  TriangleAlert,
  Workflow as WorkflowIcon,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { BranchChip, EventIcon, RunDuration, RunRow, TimeAgo } from "@/components/runs";
import { HistoryStrip, StatusBadge, StatusIcon } from "@/components/status";
import { Tooltip } from "@/components/ui/overlays";
import { Badge, Button, buttonClass, Card, EmptyState, SegmentedControl, Skeleton } from "@/components/ui/primitives";
import { LocalProjectPanel } from "@/components/local/LocalProjectPanel";
import { YamlViewer } from "@/components/YamlViewer";
import { useLocalStatus } from "@/hooks/local";
import { useRepoEntry, useScans } from "@/hooks/scans";
import { useSettings } from "@/hooks/session";
import { api, type RepoRef } from "@/lib/api";
import { PROVIDER_LABELS, ProviderIcon, repoKey, runPath, useRepoRef } from "@/lib/providers";
import type { Repository, ScannedWorkflow, WorkflowFile } from "@/lib/types";
import { cn, eventLabel, firstLine } from "@/lib/utils";
import { ListSkeleton, Page } from "./OverviewPage";

type Tab = "workflows" | "runs" | "files" | "local";

export function RepoPage() {
  const repoRef = useRepoRef();
  const { provider, full_name: fullName } = repoRef;
  const key = repoKey(provider, fullName);
  const owner = fullName.slice(0, fullName.lastIndexOf("/"));
  const name = fullName.slice(fullName.lastIndexOf("/") + 1);
  const labels = PROVIDER_LABELS[provider];
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "workflows";
  const entry = useRepoEntry(key);
  const { refreshRepo } = useScans();
  const { isFavorite, toggleFavorite } = useSettings();

  const repoQuery = useQuery({
    queryKey: ["repository", key],
    queryFn: () => api.getRepository(repoRef),
    enabled: !entry,
    staleTime: 5 * 60_000,
  });
  const scanQuery = useQuery({
    queryKey: ["scan", key],
    queryFn: () => api.scanRepository(repoRef),
    enabled: !entry,
  });

  const repo = entry?.repo ?? repoQuery.data;
  const scan = entry?.scan ?? scanQuery.data;
  const workflows = (scan?.workflows ?? []).filter((wf) => !wf.dynamic || wf.latest_run);
  const favorite = isFavorite(key);
  const localStatus = useLocalStatus(key).data;
  const localBadge = localStatus?.linked
    ? localStatus.error
      ? "!"
      : (localStatus.behind ?? 0) > 0
        ? `↓${localStatus.behind}`
        : localStatus.dirty
          ? "●"
          : undefined
    : undefined;

  const setTab = (next: Tab, extra: Record<string, string> = {}) => setParams({ tab: next, ...extra }, { replace: true });

  if (repoQuery.error && !repo) {
    return (
      <Page>
        <EmptyState icon={<TriangleAlert />} title="Dépôt inaccessible" description={repoQuery.error.message} />
      </Page>
    );
  }

  return (
    <Page>
      {/* En-tête */}
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface shadow-soft">
          {scan ? <StatusIcon state={scan.state} className="size-5" /> : <Skeleton className="size-5 rounded-full" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Tooltip content={labels.label}>
              <span className="shrink-0">
                <ProviderIcon provider={provider} className="size-5" />
              </span>
            </Tooltip>
            <h1 className="truncate text-[22px] font-semibold tracking-tight">
              <span className="font-normal text-fg-muted">{owner}/</span>
              {name}
            </h1>
            {repo?.private ? (
              <Badge>
                <Lock /> Privé
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-muted">
            {repo?.description ? <span>{repo.description}</span> : null}
            {repo ? (
              <span className="inline-flex items-center gap-1">
                <GitBranch className="size-3.5 text-fg-subtle" /> {repo.default_branch}
              </span>
            ) : null}
            {repo?.language ? <span>{repo.language}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}>
            <Button variant="secondary" size="icon" onClick={() => toggleFavorite(key)} aria-label="Favori">
              <Star className={cn(favorite && "fill-running text-running")} />
            </Button>
          </Tooltip>
          <Tooltip content="Actualiser">
            <Button variant="secondary" size="icon" onClick={() => void refreshRepo(key)} aria-label="Actualiser">
              <RefreshCw />
            </Button>
          </Tooltip>
          {repo ? (
            <Button variant="secondary" onClick={() => void api.openExternal(ciUrl(repo))}>
              <ExternalLink /> {labels.label}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mb-5 flex items-center justify-between border-b border-line">
        <div className="-mb-px flex gap-1">
          <TabButton active={tab === "workflows"} onClick={() => setTab("workflows")} icon={<WorkflowIcon />} count={workflows.length}>
            {labels.workflows}
          </TabButton>
          <TabButton active={tab === "runs"} onClick={() => setTab("runs")} icon={<History />}>
            Exécutions
          </TabButton>
          <TabButton active={tab === "files"} onClick={() => setTab("files")} icon={<FileCode2 />}>
            Fichiers CI
          </TabButton>
          <TabButton active={tab === "local"} onClick={() => setTab("local")} icon={<Laptop />} badge={localBadge} dimmed={localStatus !== undefined && !localStatus.linked}>
            Projet local
          </TabButton>
        </div>
      </div>

      {tab === "local" ? (
        repo ? (
          <LocalProjectPanel repo={repo} />
        ) : (
          <Card>
            <ListSkeleton rows={2} />
          </Card>
        )
      ) : !scan ? (
        <Card>
          <ListSkeleton rows={3} />
        </Card>
      ) : !scan.has_ci ? (
        <Card>
          <EmptyState
            icon={<Zap />}
            title={`Aucun pipeline ${labels.ci}`}
            description={`Ce dépôt ne contient pas encore de configuration (${labels.config}). La génération automatique de pipelines arrive bientôt dans Easy CI.`}
            action={
              repo ? (
                <Button variant="secondary" onClick={() => void api.openExternal(ciUrl(repo))}>
                  <ExternalLink /> Configurer la CI sur {labels.label}
                </Button>
              ) : null
            }
          />
        </Card>
      ) : tab === "workflows" ? (
        <WorkflowsTab
          repoRef={repoRef}
          workflows={workflows}
          onShowRuns={(wf) => setTab("runs", { workflow: String(wf.id) })}
          onShowFile={(wf) => setTab("files", { path: wf.path })}
        />
      ) : tab === "runs" ? (
        <RunsTab repoRef={repoRef} workflows={workflows} workflowId={params.get("workflow")} onWorkflowChange={(id) => setTab("runs", id ? { workflow: id } : {})} />
      ) : (
        <FilesTab repoRef={repoRef} workflows={workflows.filter((wf) => !wf.dynamic)} selectedPath={params.get("path")} onSelect={(path) => setTab("files", { path })} />
      )}
    </Page>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
  count,
  badge,
  dimmed,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  count?: number;
  badge?: string;
  dimmed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex h-10 items-center gap-2 px-3 text-[13.5px] font-medium transition-colors [&_svg]:size-4",
        active ? "text-fg" : "text-fg-muted hover:text-fg",
      )}
    >
      <span className={active ? "text-accent" : "text-fg-subtle"}>{icon}</span>
      {children}
      {count !== undefined ? <span className="rounded-full bg-surface-3 px-1.5 text-[11px] text-fg-muted tabular">{count}</span> : null}
      {badge ? <span className="rounded-full bg-running/15 px-1.5 text-[11px] font-semibold text-fg tabular">{badge}</span> : null}
      {dimmed && !active ? <span className="size-1.5 rounded-full bg-fg-subtle/50" aria-label="non lié" /> : null}
      <span className={cn("absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-colors", active ? "bg-accent" : "bg-transparent")} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Workflows                                                                  */
/* -------------------------------------------------------------------------- */

function WorkflowsTab({
  repoRef,
  workflows,
  onShowRuns,
  onShowFile,
}: {
  repoRef: RepoRef;
  workflows: ScannedWorkflow[];
  onShowRuns: (wf: ScannedWorkflow) => void;
  onShowFile: (wf: ScannedWorkflow) => void;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {workflows.map((wf) => {
        const run = wf.latest_run;
        return (
          <Card key={wf.id} className="group flex flex-col p-4 transition-shadow hover:shadow-pop">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-[14.5px] font-semibold">{wf.name}</h3>
                  {wf.state !== "active" ? <Badge>Désactivé</Badge> : null}
                </div>
                <button
                  onClick={() => !wf.dynamic && onShowFile(wf)}
                  className={cn("mt-0.5 truncate font-mono text-[11.5px] text-fg-subtle", !wf.dynamic && "hover:text-accent hover:underline")}
                >
                  {wf.dynamic ? (repoRef.provider === "gitlab" ? `Configuration externe : ${wf.path}` : "Workflow géré par GitHub") : wf.path}
                </button>
              </div>
              {run ? <StatusBadge state={run.state} /> : <StatusBadge state="none" />}
            </div>

            {run ? (
              <Link
                to={runPath(repoRef.provider, repoRef.full_name, run.id)}
                className="mt-4 block rounded-lg border border-line bg-surface-2/50 px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                <div className="truncate text-[13px] font-medium">{firstLine(run.commit_message) || run.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-muted">
                  <span className="text-fg-subtle">#{run.run_number}</span>
                  <span className="inline-flex items-center gap-1">
                    <EventIcon event={run.event} className="text-fg-subtle" />
                    {eventLabel(run.event)}
                  </span>
                  <BranchChip branch={run.branch} />
                  <TimeAgo date={run.created_at} />
                  <RunDuration run={run} className="ml-auto" />
                </div>
              </Link>
            ) : (
              <p className="mt-4 text-[13px] text-fg-subtle">Ce workflow n'a encore jamais été exécuté.</p>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <HistoryStrip history={wf.history} provider={repoRef.provider} fullName={repoRef.full_name} />
              <button onClick={() => onShowRuns(wf)} className="flex items-center gap-1 text-[12.5px] font-medium text-fg-muted transition-colors hover:text-fg">
                Historique <ArrowRight className="size-3.5" />
              </button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Exécutions                                                                 */
/* -------------------------------------------------------------------------- */

const STATUS_FILTERS = [
  { value: "", label: "Tous" },
  { value: "failure", label: "Échecs" },
  { value: "success", label: "Réussis" },
  { value: "running", label: "En cours" },
];

function RunsTab({
  repoRef,
  workflows,
  workflowId,
  onWorkflowChange,
}: {
  repoRef: RepoRef;
  workflows: ScannedWorkflow[];
  workflowId: string | null;
  onWorkflowChange: (id: string | null) => void;
}) {
  const [status, setStatus] = useState("");
  const hasActive = workflows.some((wf) => wf.latest_run && ["running", "queued"].includes(wf.latest_run.state));

  const query = useInfiniteQuery({
    queryKey: ["runs", repoKey(repoRef.provider, repoRef.full_name), workflowId, status],
    queryFn: ({ pageParam }) =>
      api.listRuns(repoRef, { workflow_id: workflowId ?? undefined, status: status || undefined, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    refetchInterval: hasActive ? 8_000 : 60_000,
  });
  const runs = query.data?.pages.flatMap((page) => page.runs) ?? [];
  const total = query.data?.pages[0]?.total_count;

  return (
    <div className={cn("grid gap-5", workflows.length > 1 && "lg:grid-cols-[220px_minmax(0,1fr)]")}>
      {workflows.length > 1 ? (
        <div className="flex flex-col gap-0.5">
          <WorkflowFilter active={!workflowId} onClick={() => onWorkflowChange(null)} icon={<Layers className="size-4 text-fg-subtle" />}>
            Tous les workflows
          </WorkflowFilter>
          {workflows.map((wf) => (
            <WorkflowFilter
              key={wf.id}
              active={workflowId === String(wf.id)}
              onClick={() => onWorkflowChange(String(wf.id))}
              icon={<StatusIcon state={wf.latest_run?.state ?? "none"} className="size-3.5" />}
            >
              {wf.name}
            </WorkflowFilter>
          ))}
        </div>
      ) : null}

      <div className="min-w-0">
        <div className="mb-3 flex items-center justify-between">
          <SegmentedControl value={status} onChange={setStatus} options={STATUS_FILTERS} />
          {total !== undefined ? <span className="text-[12.5px] text-fg-subtle tabular">{total} exécution{total > 1 ? "s" : ""}</span> : null}
        </div>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <ListSkeleton rows={6} />
          ) : query.error ? (
            <EmptyState icon={<TriangleAlert />} title="Chargement impossible" description={query.error.message} />
          ) : runs.length === 0 ? (
            <EmptyState icon={<History />} title="Aucune exécution" description="Aucune exécution ne correspond à ces filtres." />
          ) : (
            <div className="divide-y divide-line">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} provider={repoRef.provider} fullName={repoRef.full_name} showWorkflow={!workflowId && workflows.length > 1} />
              ))}
            </div>
          )}
        </Card>
        {query.hasNextPage ? (
          <div className="mt-3 flex justify-center">
            <Button variant="ghost" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
              Charger plus
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkflowFilter({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors",
        active ? "bg-surface-2 font-medium text-fg ring-1 ring-line ring-inset" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Fichiers CI                                                                */
/* -------------------------------------------------------------------------- */

function FilesTab({
  repoRef,
  workflows,
  selectedPath,
  onSelect,
}: {
  repoRef: RepoRef;
  workflows: ScannedWorkflow[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const path = selectedPath ?? workflows[0]?.path;
  const fileQuery = useQuery({
    queryKey: ["workflow-file", repoKey(repoRef.provider, repoRef.full_name), path],
    queryFn: () => api.getWorkflowFile(repoRef, path!),
    enabled: Boolean(path),
    staleTime: 60_000,
  });

  if (workflows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<FileCode2 />} title="Aucun fichier de workflow" description="La configuration de ce dépôt est gérée en dehors du dépôt (modèle ou fichier distant)." />
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="flex flex-col gap-0.5">
        <div className="mb-1 px-2.5 font-mono text-[11px] text-fg-subtle">{repoRef.provider === "github" ? ".github/workflows/" : "Racine du dépôt"}</div>
        {workflows.map((wf) => (
          <WorkflowFilter key={wf.id} active={wf.path === path} onClick={() => onSelect(wf.path)} icon={<FileCode2 className="size-4 text-fg-subtle" />}>
            <span className="font-mono text-[12.5px]">{wf.path.split("/").pop()}</span>
          </WorkflowFilter>
        ))}
      </div>

      <div className="min-w-0 space-y-4">
        {fileQuery.isPending ? (
          <Card className="h-[480px] p-4">
            <Skeleton className="h-full w-full" />
          </Card>
        ) : fileQuery.error ? (
          <Card>
            <EmptyState icon={<TriangleAlert />} title="Fichier illisible" description={fileQuery.error.message} />
          </Card>
        ) : fileQuery.data ? (
          <WorkflowFileView file={fileQuery.data} providerLabel={PROVIDER_LABELS[repoRef.provider].label} repoRef={repoRef} />
        ) : null}
      </div>
    </div>
  );
}

function EditButton({ repoRef, path }: { repoRef: RepoRef; path: string }) {
  const status = useLocalStatus(repoKey(repoRef.provider, repoRef.full_name)).data;
  const base = `/repos/${repoRef.provider}/${encodeURIComponent(repoRef.full_name)}`;
  if (status?.linked && !status.error) {
    return (
      <Tooltip content="Modifier dans le clone local, puis commiter et proposer quand vous le décidez">
        <Link to={`${base}/edit?path=${encodeURIComponent(path)}`} className={buttonClass("secondary", "sm")}>
          <Pencil className="size-3.5" /> Modifier
        </Link>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Les modifications se font dans le clone local : liez d'abord un dossier.">
      <Link to={`${base}?tab=local`} className={buttonClass("ghost", "sm")}>
        <Pencil className="size-3.5" /> Modifier…
      </Link>
    </Tooltip>
  );
}

function WorkflowFileView({ file, providerLabel, repoRef }: { file: WorkflowFile; providerLabel: string; repoRef: RepoRef }) {
  const [copied, setCopied] = useState(false);
  const { summary } = file;
  const lineCount = useMemo(() => file.content.split("\n").length, [file.content]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <>
      {summary.valid ? (
        <Card className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div>
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">Déclencheurs</div>
            <div className="flex flex-wrap gap-1.5">
              {summary.triggers.map((trigger) => (
                <Tooltip key={trigger.event} content={trigger.details.length ? trigger.details.join(" · ") : null}>
                  <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-accent-soft px-2 text-[12px] font-medium text-accent">
                    <EventIcon event={trigger.event} />
                    {eventLabel(trigger.event)}
                    {trigger.details.length ? <span className="font-normal text-accent/70">({trigger.details.length})</span> : null}
                  </span>
                </Tooltip>
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
              {summary.stages.length ? "Stages et jobs" : "Jobs"}
            </div>
            {summary.stages.length ? (
              <div className="space-y-2">
                {summary.stages.map((stage, index) => (
                  <div key={stage} className="flex items-start gap-2.5">
                    <span className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 px-1.5 text-[10.5px] font-semibold text-fg-muted tabular">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-mono text-[11.5px] text-fg-muted">{stage}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {summary.jobs.filter((job) => job.stage === stage).map((job) => (
                          <JobChip key={job.id} job={job} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {summary.jobs.map((job) => (
                  <JobChip key={job.id} job={job} />
                ))}
              </div>
            )}
            {summary.includes.length ? (
              <div className="mt-3 text-[12px] text-fg-muted">
                <span className="text-fg-subtle">Inclut : </span>
                {summary.includes.map((include, index) => (
                  <span key={include}>
                    <code className="font-mono text-[11.5px]">{include}</code>
                    {index < summary.includes.length - 1 ? ", " : ""}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      ) : (
        <Card className="flex items-start gap-3 border-failure/30 bg-failure/5 p-4">
          <StatusIcon state="failure" className="mt-0.5" />
          <div className="text-[13px]">
            <div className="font-medium">YAML invalide{summary.error_line ? ` (ligne ${summary.error_line})` : ""}</div>
            <div className="text-fg-muted">{summary.error}</div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <FileCode2 className="size-4 text-fg-subtle" />
          <span className="font-mono text-[12.5px]">{file.path}</span>
          <span className="text-[12px] text-fg-subtle">{lineCount} lignes</span>
          <div className="ml-auto flex items-center gap-1.5">
            <EditButton repoRef={repoRef} path={file.path} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(file.content).then(() => setCopied(true));
              }}
            >
              {copied ? <Check className="text-success" /> : <Copy />}
              {copied ? "Copié" : "Copier"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void api.openExternal(file.html_url)}>
              <ExternalLink /> {providerLabel}
            </Button>
          </div>
        </div>
        <div className="h-[min(640px,65vh)] bg-log">
          <YamlViewer content={file.content} highlightLine={summary.error_line} />
        </div>
      </Card>
    </>
  );
}

/** Page des pipelines du dépôt sur la plateforme d'origine. */
function ciUrl(repo: Repository) {
  if (repo.provider === "gitlab") return `${repo.html_url}/-/pipelines`;
  if (repo.provider === "bitbucket") return `${repo.html_url}/pipelines`;
  return `${repo.html_url}/actions`;
}

function JobChip({ job }: { job: WorkflowFile["summary"]["jobs"][number] }) {
  return (
    <Tooltip
      content={
        <span>
          {job.runs_on ? (
            <>
              Exécuté sur : {job.runs_on}
              <br />
            </>
          ) : null}
          {job.steps} commande{job.steps > 1 ? "s" : ""}
          {job.needs.length ? (
            <>
              <br />
              Dépend de : {job.needs.join(", ")}
            </>
          ) : null}
          {job.uses ? (
            <>
              <br />
              {job.uses}
            </>
          ) : null}
          {job.matrix ? (
            <>
              <br />
              Matrice de build
            </>
          ) : null}
        </span>
      }
    >
      <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-surface-2 px-2 text-[12px] ring-1 ring-line ring-inset">
        {job.needs.length ? <ArrowRight className="size-3 text-fg-subtle" /> : null}
        <span className="font-medium">{job.name}</span>
        {job.matrix ? <Badge className="h-4 px-1 text-[10px]">matrix</Badge> : null}
      </span>
    </Tooltip>
  );
}
