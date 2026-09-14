import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  FileCode2,
  FilePlus2,
  GitCompare,
  ListChecks,
  RotateCcw,
  Save,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  Workflow as WorkflowIcon,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker, useSearchParams } from "react-router";
import { toast } from "sonner";
import { CiEditor, type CiEditorHandle } from "@/components/editor/CiEditor";
import { CommitDialog, PublicationCard } from "@/components/editor/PublishFlow";
import { DiffViewer } from "@/components/local/DiffViewer";
import { CiStateBadge } from "@/components/local/LocalProjectPanel";
import { EventIcon } from "@/components/runs";
import { Modal, Tooltip } from "@/components/ui/overlays";
import { Badge, Button, buttonClass, Card, EmptyState, Input, Kbd, SegmentedControl, Skeleton, Spinner } from "@/components/ui/primitives";
import { errorMessage, useLocalStatus } from "@/hooks/local";
import { api, ApiError } from "@/lib/api";
import { PROVIDER_LABELS, ProviderIcon, repoKey as makeRepoKey, repoPath, useRepoRef } from "@/lib/providers";
import type { ProviderId, ValidationResult } from "@/lib/types";
import { cn, eventLabel } from "@/lib/utils";

type SideTab = "validation" | "summary" | "diff";

const DEFAULT_PATH: Record<ProviderId, string> = {
  github: ".github/workflows/ci.yml",
  gitlab: ".gitlab-ci.yml",
  bitbucket: "bitbucket-pipelines.yml",
};

const NEW_FILE_TEMPLATES: Record<ProviderId, string> = {
  github: `name: Nouveau workflow

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "À compléter"
`,
  gitlab: `stages: [test]

test:
  stage: test
  image: alpine:3.20
  script:
    - echo "À compléter"
`,
  bitbucket: `image: atlassian/default-image:4

pipelines:
  default:
    - step:
        name: Test
        script:
          - echo "À compléter"
`,
};

export function EditorPage() {
  const ref = useRepoRef();
  const key = makeRepoKey(ref.provider, ref.full_name);
  const [params, setParams] = useSearchParams();
  const statusQuery = useLocalStatus(key);
  const status = statusQuery.data;
  const linked = status?.linked && !status.error ? status : null;

  const localFiles = (linked?.ci_files ?? []).filter((file) => file.local);
  const requestedPath = params.get("path");
  const path = requestedPath ?? localFiles[0]?.path ?? DEFAULT_PATH[ref.provider];

  if (statusQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!linked) {
    return (
      <div className="mx-auto max-w-xl px-8 py-16">
        <Card>
          <EmptyState
            icon={<FileCode2 />}
            title="Liez d'abord un dossier local"
            description="Easy CI modifie les fichiers CI dans le clone de ce dépôt sur votre machine : liez un dossier existant ou clonez le dépôt."
            action={
              <Link to={repoPath(ref.provider, ref.full_name, "?tab=local")} className={buttonClass("primary")}>
                Ouvrir l'onglet Projet local
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <EditorWorkspace
      key={`${key}:${path}`}
      repoKey={key}
      provider={ref.provider}
      fullName={ref.full_name}
      path={path}
      status={linked}
      onSelectPath={(next) => setParams({ path: next }, { replace: true })}
    />
  );
}

/* -------------------------------------------------------------------------- */

type LinkedStatus = Extract<NonNullable<ReturnType<typeof useLocalStatus>["data"]>, { linked: true }>;

function EditorWorkspace({
  repoKey,
  provider,
  fullName,
  path,
  status,
  onSelectPath,
}: {
  repoKey: string;
  provider: ProviderId;
  fullName: string;
  path: string;
  status: LinkedStatus;
  onSelectPath: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const editorRef = useRef<CiEditorHandle>(null);
  const fileQuery = useQuery({ queryKey: ["ci-file", repoKey, path], queryFn: () => api.readCiFile(repoKey, path), staleTime: Number.POSITIVE_INFINITY, gcTime: 0 });
  const file = fileQuery.data;

  const [content, setContent] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ content: string; hash: string | null } | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [tab, setTab] = useState<SideTab>("validation");
  const [commitOpen, setCommitOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  // Chargement initial du fichier (ou modèle pour un nouveau fichier).
  useEffect(() => {
    if (!file || saved) return;
    const initial = file.exists ? file.content : NEW_FILE_TEMPLATES[provider];
    setContent(initial);
    setSaved({ content: file.exists ? file.content : "", hash: file.hash });
  }, [file]);

  const dirty = content !== null && saved !== null && content !== saved.content;
  const ciFile = status.ci_files?.find((f) => f.path === path);

  // Validation à la volée, avec un court délai après la frappe.
  useEffect(() => {
    if (content === null) return;
    setValidating(true);
    const timer = setTimeout(() => {
      api
        .validateCi(provider, content)
        .then(setValidation)
        .catch(() => undefined)
        .finally(() => setValidating(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [content, provider]);

  const save = useMutation({
    mutationFn: ({ overwrite }: { overwrite: boolean }) => api.saveCiFile(repoKey, path, content ?? "", saved?.hash ?? null, overwrite),
    onSuccess: (result) => {
      const written = (content ?? "").endsWith("\n") ? content ?? "" : `${content ?? ""}\n`;
      setSaved({ content: written, hash: result.hash });
      if (written !== content) setContent(written);
      queryClient.setQueryData(["local-status", repoKey], result.status);
      void queryClient.invalidateQueries({ queryKey: ["local-diff", repoKey] });
      void queryClient.invalidateQueries({ queryKey: ["publication", repoKey] });
      const errors = validation?.errors ?? 0;
      if (errors) toast.warning("Enregistré dans le dossier local", { description: `${errors} erreur${errors > 1 ? "s" : ""} de validation à corriger avant de commiter.` });
      else toast.success("Enregistré dans le dossier local", { description: path });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "file_conflict") setConflict(true);
      else toast.error("Enregistrement impossible", { description: errorMessage(error) });
    },
  });

  const saveNow = useCallback(() => {
    if (dirty && !save.isPending) save.mutate({ overwrite: false });
  }, [dirty, save]);

  const restore = useMutation({
    mutationFn: () => api.discardCiFile(repoKey, path),
    onSuccess: async (nextStatus) => {
      queryClient.setQueryData(["local-status", repoKey], nextStatus);
      const reread = await api.readCiFile(repoKey, path);
      queryClient.setQueryData(["ci-file", repoKey, path], reread);
      const next = reread.exists ? reread.content : NEW_FILE_TEMPLATES[provider];
      setSaved({ content: reread.exists ? reread.content : "", hash: reread.hash });
      setContent(next);
      toast.success(reread.exists ? "Version commitée restaurée" : "Fichier non commité supprimé");
      setConfirmRestore(false);
    },
    onError: (error) => toast.error("Restauration impossible", { description: errorMessage(error) }),
  });

  const reloadFromDisk = async () => {
    const reread = await api.readCiFile(repoKey, path);
    queryClient.setQueryData(["ci-file", repoKey, path], reread);
    setSaved({ content: reread.content, hash: reread.hash });
    setContent(reread.content);
    setConflict(false);
  };

  // Garde : pas de départ silencieux avec des modifications non enregistrées.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const errors = validation?.errors ?? 0;
  const warnings = validation?.warnings ?? 0;
  const localFiles = (status.ci_files ?? []).filter((f) => f.local || f.path === path);
  const canCreateFile = provider === "github";
  const hasUncommitted = (status.ci_files ?? []).some((f) => f.state === "uncommitted" || f.state === "untracked");

  if (fileQuery.error) {
    return (
      <div className="mx-auto max-w-xl px-8 py-16">
        <Card>
          <EmptyState icon={<TriangleAlert />} title="Fichier illisible" description={errorMessage(fileQuery.error)} />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Barre supérieure */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface/60 px-5 py-2.5">
        <Link to={repoPath(provider, fullName, "?tab=local")} className={buttonClass("ghost", "sm")}>
          <ArrowLeft className="size-3.5" /> Projet local
        </Link>
        <div className="h-5 w-px bg-line" />
        <ProviderIcon provider={provider} className="size-4" />
        <FileSwitcher
          files={localFiles.map((f) => f.path)}
          current={path}
          onSelect={(next) => {
            if (dirty && !window.confirm("Des modifications ne sont pas enregistrées. Changer de fichier quand même ?")) return;
            onSelectPath(next);
          }}
        />
        {canCreateFile ? (
          <Tooltip content="Nouveau fichier de workflow">
            <Button variant="ghost" size="icon-sm" onClick={() => setNewFileOpen(true)} aria-label="Nouveau workflow">
              <FilePlus2 />
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip content="Générer un pipeline avec l'assistant">
          <Link to={repoPath(provider, fullName, "/generate")} className={buttonClass("ghost", "icon-sm")} aria-label="Générer un pipeline">
            <Zap />
          </Link>
        </Tooltip>
        {!file?.exists && file ? <Badge className="border-accent/25 bg-accent-soft text-fg">Nouveau fichier</Badge> : ciFile ? <CiStateBadge state={ciFile.state} /> : null}
        {dirty ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-running">
            <span className="size-1.5 rounded-full bg-running" /> Non enregistré
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <ValidationChip validating={validating} errors={errors} warnings={warnings} onClick={() => setTab("validation")} />
          {dirty ? (
            <Tooltip content="Revenir à la version enregistrée sur le disque">
              <Button variant="ghost" size="sm" onClick={() => saved && setContent(saved.content)}>
                <Undo2 className="size-3.5" /> Annuler
              </Button>
            </Tooltip>
          ) : ciFile && (ciFile.state === "uncommitted" || ciFile.state === "untracked") ? (
            <Tooltip content={ciFile.state === "untracked" ? "Supprimer ce fichier jamais commité" : "Restaurer la dernière version commitée"}>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRestore(true)}>
                <RotateCcw className="size-3.5" /> Restaurer
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content={<span className="flex items-center gap-2">Écrire le fichier dans le dossier local <Kbd>⌘</Kbd><Kbd>S</Kbd></span>}>
            <span>
              <Button variant={dirty ? "primary" : "secondary"} size="sm" onClick={saveNow} loading={save.isPending} disabled={!dirty}>
                <Save className="size-3.5" /> Enregistrer
              </Button>
            </span>
          </Tooltip>
          <Tooltip content={dirty ? "Enregistrez d'abord vos modifications" : hasUncommitted ? "Créer un commit local" : "Aucune modification à commiter"}>
            <span>
              <Button variant={!dirty && hasUncommitted ? "primary" : "secondary"} size="sm" onClick={() => setCommitOpen(true)} disabled={dirty || !hasUncommitted}>
                Commiter…
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px]">
        {/* Éditeur */}
        <div className="min-h-0 bg-log">
          {content === null ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/5" />
            </div>
          ) : (
            <CiEditor
              ref={editorRef}
              documentKey={`${repoKey}:${path}`}
              value={content}
              provider={provider}
              problems={validation?.problems ?? []}
              onChange={setContent}
              onSave={saveNow}
            />
          )}
        </div>

        {/* Panneau latéral */}
        <aside className="flex min-h-0 flex-col border-l border-line bg-surface/40">
          <div className="border-b border-line px-3 py-2.5">
            <SegmentedControl<SideTab>
              value={tab}
              onChange={setTab}
              className="grid w-full grid-cols-3 [&>button]:justify-center"
              options={[
                { value: "validation", label: <><ListChecks />Validation</> },
                { value: "summary", label: <><WorkflowIcon />Aperçu</> },
                { value: "diff", label: <><GitCompare />Diff</> },
              ]}
            />
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
            {tab === "validation" ? (
              <ValidationPanel repoKey={repoKey} provider={provider} content={content ?? ""} validation={validation} validating={validating} onGoTo={(line, column) => editorRef.current?.goTo(line, column)} />
            ) : tab === "summary" ? (
              <SummaryPanel provider={provider} content={content ?? ""} />
            ) : (
              <DiffPanel repoKey={repoKey} path={path} dirty={dirty} exists={Boolean(file?.exists) || Boolean(ciFile)} />
            )}
          </div>
          <div className="border-t border-line p-3">
            <PublicationCard repoKey={repoKey} provider={provider} status={status} compact onCommit={dirty ? undefined : () => setCommitOpen(true)} />
          </div>
        </aside>
      </div>

      <CommitDialog
        open={commitOpen}
        onOpenChange={setCommitOpen}
        repoKey={repoKey}
        status={status}
        focusPath={path}
        blockedReason={errors ? `Ce fichier contient ${errors} erreur${errors > 1 ? "s" : ""} de validation : le pipeline risque d'échouer dès son démarrage.` : null}
      />

      <Modal open={conflict} onOpenChange={setConflict} title="Fichier modifié ailleurs" description={`« ${path} » a changé sur le disque depuis son ouverture (autre éditeur, git pull…).`}>
        <div className="flex flex-wrap justify-end gap-2 px-5 py-4">
          <Button variant="ghost" onClick={() => setConflict(false)}>
            Continuer à éditer
          </Button>
          <Button onClick={() => void reloadFromDisk()}>Recharger la version du disque</Button>
          <Button variant="danger" onClick={() => (setConflict(false), save.mutate({ overwrite: true }))}>
            Écraser avec ma version
          </Button>
        </div>
      </Modal>

      <Modal
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        title={ciFile?.state === "untracked" ? "Supprimer ce fichier ?" : "Restaurer la version commitée ?"}
        description={
          ciFile?.state === "untracked"
            ? "Ce fichier n'a jamais été commité : il sera supprimé du dossier local. Cette action est définitive."
            : "Les modifications enregistrées mais non commitées de ce fichier seront perdues. Cette action est définitive."
        }
      >
        <div className="flex justify-end gap-2 px-5 py-4">
          <Button variant="ghost" onClick={() => setConfirmRestore(false)}>
            Annuler
          </Button>
          <Button variant="danger" onClick={() => restore.mutate()} loading={restore.isPending}>
            <RotateCcw /> {ciFile?.state === "untracked" ? "Supprimer" : "Restaurer"}
          </Button>
        </div>
      </Modal>

      <NewWorkflowDialog
        open={newFileOpen}
        onOpenChange={setNewFileOpen}
        existing={(status.ci_files ?? []).map((f) => f.path)}
        onCreate={(next) => {
          setNewFileOpen(false);
          onSelectPath(next);
        }}
      />

      <Modal open={blocker.state === "blocked"} onOpenChange={(open) => !open && blocker.reset?.()} title="Modifications non enregistrées" description={`Vos changements de « ${path} » ne sont pas encore écrits dans le dossier local.`}>
        <div className="flex flex-wrap justify-end gap-2 px-5 py-4">
          <Button variant="ghost" onClick={() => blocker.reset?.()}>
            Rester
          </Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            Quitter sans enregistrer
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              save.mutate(
                { overwrite: false },
                { onSuccess: () => blocker.proceed?.(), onError: () => blocker.reset?.() },
              )
            }
          >
            <Save /> Enregistrer et quitter
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function FileSwitcher({ files, current, onSelect }: { files: string[]; current: string; onSelect: (path: string) => void }) {
  const options = files.includes(current) ? files : [...files, current];
  return (
    <select
      value={current}
      onChange={(event) => onSelect(event.target.value)}
      className="h-7 max-w-80 rounded-md border border-line bg-surface px-2 font-mono text-[12.5px] text-fg outline-none focus:border-accent/60"
      aria-label="Fichier à modifier"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function ValidationChip({ validating, errors, warnings, onClick }: { validating: boolean; errors: number; warnings: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors",
        errors ? "bg-failure/12 text-fg" : warnings ? "bg-running/12 text-fg" : "bg-success/12 text-fg",
      )}
    >
      {validating ? (
        <Spinner className="size-3" />
      ) : errors ? (
        <CircleAlert className="size-3.5 text-failure" />
      ) : warnings ? (
        <TriangleAlert className="size-3.5 text-running" />
      ) : (
        <CircleCheck className="size-3.5 text-success" />
      )}
      {errors ? `${errors} erreur${errors > 1 ? "s" : ""}` : warnings ? `${warnings} avertissement${warnings > 1 ? "s" : ""}` : "Valide"}
    </button>
  );
}

function ValidationPanel({
  repoKey,
  provider,
  content,
  validation,
  validating,
  onGoTo,
}: {
  repoKey: string;
  provider: ProviderId;
  content: string;
  validation: ValidationResult | null;
  validating: boolean;
  onGoTo: (line: number, column: number | null) => void;
}) {
  const lint = useMutation({ mutationFn: () => api.lintCiRemote(repoKey, content) });
  useEffect(() => lint.reset(), [content]);

  return (
    <div className="space-y-4">
      {!validation ? (
        <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">
          <Spinner className="size-3.5" /> Analyse…
        </div>
      ) : validation.problems.length === 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success/[0.07] p-3.5">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
          <div className="text-[12.5px] leading-relaxed text-fg-muted">
            <div className="font-medium text-fg">Aucun problème détecté</div>
            Syntaxe YAML et structure {PROVIDER_LABELS[provider].ci} vérifiées{validating ? "…" : "."}
          </div>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {validation.problems.map((problem, index) => (
            <li key={index}>
              <button
                onClick={() => problem.line && onGoTo(problem.line, problem.column)}
                className="flex w-full items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                {problem.severity === "error" ? <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-failure" /> : <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-running" />}
                <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-fg">{problem.message}</span>
                {problem.line ? <span className="shrink-0 font-mono text-[11px] text-fg-subtle">L{problem.line}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {provider === "gitlab" ? (
        <div className="rounded-xl border border-line bg-surface p-3.5">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <ShieldCheck className="size-4 text-accent" /> Validation officielle GitLab
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
            Envoie le contenu à l'outil CI Lint de GitLab, qui résout les « include » et « extends ». Le dépôt n'est pas modifié.
          </p>
          <Button size="sm" className="mt-2.5" onClick={() => lint.mutate()} loading={lint.isPending}>
            Valider avec GitLab
          </Button>
          {lint.error ? <p className="mt-2 text-[12px] text-failure">{errorMessage(lint.error)}</p> : null}
          {lint.data ? (
            <div className="mt-3 space-y-1 text-[12.5px]">
              <div className={cn("flex items-center gap-1.5 font-medium", lint.data.valid ? "text-success" : "text-failure")}>
                {lint.data.valid ? <CircleCheck className="size-3.5" /> : <CircleAlert className="size-3.5" />}
                {lint.data.valid ? "Configuration valide selon GitLab" : "GitLab signale des erreurs"}
              </div>
              {[...lint.data.errors, ...lint.data.warnings].map((message, index) => (
                <p key={index} className="text-fg-muted">
                  • {message}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SummaryPanel({ provider, content }: { provider: ProviderId; content: string }) {
  const [debounced, setDebounced] = useState(content);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(content), 400);
    return () => clearTimeout(timer);
  }, [content]);
  const summary = useQuery({ queryKey: ["ci-summary", provider, debounced], queryFn: () => api.summarizeCi(provider, debounced), placeholderData: (previous) => previous });
  const data = summary.data;
  if (!data) return <Spinner className="size-4" />;
  if (!data.valid) return <p className="text-[12.5px] text-fg-muted">Corrigez les erreurs YAML pour afficher l'aperçu.</p>;

  const groups = data.stages.length ? data.stages.map((stage) => ({ stage, jobs: data.jobs.filter((job) => job.stage === stage) })) : [{ stage: null, jobs: data.jobs }];
  return (
    <div className="space-y-4 text-[12.5px]">
      <Section title="Déclencheurs">
        <div className="flex flex-wrap gap-1.5">
          {data.triggers.length ? (
            data.triggers.map((trigger) => (
              <Tooltip key={trigger.event} content={trigger.details.join(" · ") || null}>
                <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-accent-soft px-2 font-medium text-accent">
                  <EventIcon event={trigger.event} />
                  {eventLabel(trigger.event)}
                </span>
              </Tooltip>
            ))
          ) : (
            <span className="text-fg-subtle">Aucun</span>
          )}
        </div>
      </Section>
      <Section title={data.stages.length ? "Stages et jobs" : "Jobs"}>
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.stage ?? "jobs"}>
              {group.stage ? <div className="mb-1 font-mono text-[11.5px] text-fg-subtle">{group.stage}</div> : null}
              <ul className="space-y-1">
                {group.jobs.map((job) => (
                  <li key={job.id} className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
                    <div className="font-medium">{job.name}</div>
                    <div className="text-[11.5px] text-fg-subtle">
                      {[job.runs_on, `${job.steps} commande${job.steps > 1 ? "s" : ""}`, job.needs.length ? `après ${job.needs.join(", ")}` : null, job.matrix ? "matrice" : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function DiffPanel({ repoKey, path, dirty, exists }: { repoKey: string; path: string; dirty: boolean; exists: boolean }) {
  const diff = useQuery({ queryKey: ["local-diff", repoKey, path], queryFn: () => api.getLocalCiDiff(repoKey, path), enabled: exists });
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-fg-muted">
        Différences entre la branche distante{diff.data?.compare_ref ? ` (${diff.data.compare_ref})` : ""} et le fichier <strong className="font-medium text-fg">enregistré</strong> dans
        le dossier local.
      </p>
      {dirty ? <p className="text-[12px] text-running">Enregistrez pour inclure vos dernières modifications.</p> : null}
      {!exists ? (
        <p className="text-[12.5px] text-fg-muted">Nouveau fichier : enregistrez-le pour le comparer.</p>
      ) : diff.isPending ? (
        <Spinner className="size-4" />
      ) : diff.error ? (
        <p className="text-[12.5px] text-failure">{errorMessage(diff.error)}</p>
      ) : diff.data?.diff ? (
        <DiffViewer diff={diff.data.diff} />
      ) : (
        <p className="text-[12.5px] text-fg-muted">Identique à la branche distante.</p>
      )}
    </div>
  );
}

function NewWorkflowDialog({ open, onOpenChange, existing, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; existing: string[]; onCreate: (path: string) => void }) {
  const [name, setName] = useState("");
  const filename = useMemo(() => {
    const clean = name.trim().toLowerCase().replace(/\.ya?ml$/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return clean ? `.github/workflows/${clean}.yml` : "";
  }, [name]);
  const taken = existing.includes(filename);
  useEffect(() => setName(""), [open]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Nouveau workflow" description="Un fichier est créé dans .github/workflows à partir d'un modèle minimal, à compléter.">
      <form
        className="space-y-3 px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (filename && !taken) onCreate(filename);
        }}
      >
        <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="deploy" icon={<FileCode2 />} className="h-9" />
        <p className={cn("text-[12.5px]", taken ? "text-failure" : "text-fg-muted")}>
          {filename ? (taken ? `« ${filename} » existe déjà.` : <>Fichier : <code className="font-mono text-fg">{filename}</code></>) : "Saisissez un nom de fichier."}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={!filename || taken}>
            <FilePlus2 /> Créer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">{title}</div>
      {children}
    </div>
  );
}
