import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Blocks,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Container,
  Copy,
  FileCheck2,
  FileCode2,
  FolderTree,
  GitBranch,
  GitPullRequest,
  Hand,
  Info,
  KeyRound,
  Layers,
  ListChecks,
  Monitor,
  Package,
  Rocket,
  ScanSearch,
  Tag,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { YamlViewer } from "@/components/YamlViewer";
import { Tooltip } from "@/components/ui/overlays";
import { Badge, Button, buttonClass, Card, EmptyState, Input, SegmentedControl, Skeleton, Spinner, Switch } from "@/components/ui/primitives";
import { errorMessage, useLocalStatus } from "@/hooks/local";
import { api, ApiError } from "@/lib/api";
import { PROVIDER_LABELS, ProviderIcon, repoKey as makeRepoKey, repoPath, useRepoRef } from "@/lib/providers";
import type { DeliveryWhen, GeneratedPipeline, PipelineChoices, PipelineOptions, PipelineStep, ProjectAnalysis, ProviderId, StackOptions } from "@/lib/types";
import { cn } from "@/lib/utils";

type WizardStep = "analyse" | "steps" | "triggers" | "delivery" | "review";

const WIZARD_STEPS: { id: WizardStep; label: string; icon: ReactNode }[] = [
  { id: "analyse", label: "Analyse", icon: <ScanSearch /> },
  { id: "steps", label: "Étapes", icon: <ListChecks /> },
  { id: "triggers", label: "Déclencheurs", icon: <Zap /> },
  { id: "delivery", label: "Livraison", icon: <Rocket /> },
  { id: "review", label: "Vérifier & écrire", icon: <FileCheck2 /> },
];

const STEP_ORDER: PipelineStep[] = ["lint", "typecheck", "test", "build"];

const STEP_HINTS: Record<PipelineStep, string> = {
  lint: "Style et erreurs courantes",
  typecheck: "Cohérence des types",
  test: "Tests automatisés",
  build: "Compilation / paquet final",
};

const SCHEDULES = [
  { value: "", label: "Jamais" },
  { value: "0 3 * * *", label: "Chaque nuit (3 h UTC)" },
  { value: "0 6 * * 1", label: "Chaque lundi (6 h UTC)" },
];

const WHEN_OPTIONS: { value: DeliveryWhen; label: string }[] = [
  { value: "default_branch", label: "Branche principale" },
  { value: "tags", label: "Tags v*" },
  { value: "both", label: "Les deux" },
];

/** Commandes de déploiement proposées selon les fichiers détectés (à relire, jamais exécutées par Easy CI). */
const DEPLOY_PRESETS: Record<string, { command: (build: string | null) => string; secrets: string[]; environment?: string }> = {
  netlify: { command: (build) => [build, "npx netlify-cli deploy --prod --dir=dist"].filter(Boolean).join("\n"), secrets: ["NETLIFY_AUTH_TOKEN", "NETLIFY_SITE_ID"] },
  vercel: { command: () => 'npx vercel deploy --prod --yes --token="$VERCEL_TOKEN"', secrets: ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"] },
  fly: { command: () => "curl -fsSL https://fly.io/install.sh | sh\n~/.fly/bin/flyctl deploy --remote-only", secrets: ["FLY_API_TOKEN"] },
  cloudflare: { command: (build) => [build, "npx wrangler deploy"].filter(Boolean).join("\n"), secrets: ["CLOUDFLARE_API_TOKEN"] },
  render: { command: () => 'curl -fsS -X POST "$RENDER_DEPLOY_HOOK_URL"', secrets: ["RENDER_DEPLOY_HOOK_URL"] },
  firebase: { command: (build) => [build, "npx firebase-tools deploy --non-interactive"].filter(Boolean).join("\n"), secrets: ["FIREBASE_TOKEN"] },
  serverless: { command: () => "npx serverless deploy --stage production", secrets: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] },
};

export function GeneratePage() {
  const ref = useRepoRef();
  const key = makeRepoKey(ref.provider, ref.full_name);
  const statusQuery = useLocalStatus(key);
  const status = statusQuery.data;
  const linked = status?.linked && !status.error ? status : null;
  const analysis = useQuery({ queryKey: ["detect-project", key], queryFn: () => api.detectProject(key), enabled: Boolean(linked), gcTime: 0, staleTime: Number.POSITIVE_INFINITY });

  if (statusQuery.isPending || (linked && analysis.isPending)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-fg-muted">
        <Spinner />
        {linked ? "Analyse du projet…" : null}
      </div>
    );
  }

  if (!linked) {
    return (
      <div className="mx-auto max-w-xl px-8 py-16">
        <Card>
          <EmptyState
            icon={<FolderTree />}
            title="Liez d'abord un dossier local"
            description="L'assistant analyse les fichiers de votre clone (package.json, pyproject.toml, go.mod…) et y écrit le pipeline généré : liez un dossier existant ou clonez le dépôt."
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

  if (analysis.error || !analysis.data) {
    return (
      <div className="mx-auto max-w-xl px-8 py-16">
        <Card>
          <EmptyState icon={<TriangleAlert />} title="Analyse impossible" description={errorMessage(analysis.error)} action={<Button onClick={() => void analysis.refetch()}>Réessayer</Button>} />
        </Card>
      </div>
    );
  }

  return <Wizard key={key} repoKey={key} provider={ref.provider} fullName={ref.full_name} analysis={analysis.data} />;
}

/* -------------------------------------------------------------------------- */

function Wizard({ repoKey, provider, fullName, analysis }: { repoKey: string; provider: ProviderId; fullName: string; analysis: ProjectAnalysis }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>("analyse");
  const [options, setOptions] = useState<PipelineOptions>(analysis.options);
  const [debounced, setDebounced] = useState(options);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const labels = PROVIDER_LABELS[provider];
  const { detection, choices } = analysis;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(options), 250);
    return () => clearTimeout(timer);
  }, [options]);

  const preview = useQuery({
    queryKey: ["generate-pipeline", repoKey, debounced],
    queryFn: () => api.generatePipeline(repoKey, debounced),
    placeholderData: (previous) => previous,
    gcTime: 0,
  });
  const result = preview.data;
  const updating = preview.isFetching || debounced !== options;

  const update = (change: (draft: PipelineOptions) => void) =>
    setOptions((current) => {
      const draft = structuredClone(current);
      change(draft);
      return draft;
    });

  const write = useMutation({
    mutationFn: (pipeline: GeneratedPipeline) => api.saveCiFile(repoKey, pipeline.path, pipeline.content, pipeline.existing_hash, false),
    onSuccess: (saved, pipeline) => {
      queryClient.setQueryData(["local-status", repoKey], saved.status);
      void queryClient.invalidateQueries({ queryKey: ["publication", repoKey] });
      toast.success("Pipeline écrit dans le dossier local", { description: "Relisez-le dans l'éditeur, puis commitez quand il vous convient." });
      navigate(repoPath(provider, fullName, `/edit?path=${encodeURIComponent(pipeline.path)}`));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "file_conflict") {
        toast.error("Le fichier a changé sur le disque", { description: "L'aperçu a été actualisé : vérifiez avant de réessayer." });
        setConfirmReplace(false);
        void preview.refetch();
      } else toast.error("Écriture impossible", { description: errorMessage(error) });
    },
  });

  const index = WIZARD_STEPS.findIndex((s) => s.id === step);
  const enabledStacks = options.stacks.filter((s) => s.enabled);
  const primaryBuild = enabledStacks.find((s) => s.steps.build.enabled)?.steps.build.command ?? null;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-6 animate-fade-in">
      {/* En-tête */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link to={repoPath(provider, fullName, "?tab=local")} className={buttonClass("ghost", "sm")}>
          <ArrowLeft className="size-3.5" /> Projet local
        </Link>
        <div className="h-5 w-px bg-line" />
        <ProviderIcon provider={provider} className="size-5" />
        <div className="min-w-0">
          <h1 className="text-[19px] leading-tight font-semibold tracking-tight">Générer un pipeline {labels.ci}</h1>
          <p className="text-[12.5px] text-fg-muted">
            Modèles déterministes, sans IA : le fichier est écrit dans votre clone local, puis vous le relisez et le commitez.
          </p>
        </div>
      </div>

      {/* Progression */}
      <nav className="mb-5 flex items-center gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1 shadow-soft">
        {WIZARD_STEPS.map((item, position) => {
          const active = item.id === step;
          const done = position < index;
          return (
            <button
              key={item.id}
              onClick={() => setStep(item.id)}
              className={cn(
                "flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors [&_svg]:size-4",
                active ? "bg-accent-soft text-fg ring-1 ring-accent/25" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular",
                  active ? "bg-accent text-accent-fg" : done ? "bg-success/15 text-success" : "bg-surface-3 text-fg-subtle",
                )}
              >
                {done ? <Check className="size-3!" /> : position + 1}
              </span>
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(400px,46%)]">
        {/* Configuration */}
        <div className="@container min-w-0 space-y-4">
          {step === "analyse" ? (
            <AnalyseStep analysis={analysis} options={options} update={update} />
          ) : step === "steps" ? (
            <StepsStep provider={provider} choices={choices} options={options} update={update} />
          ) : step === "triggers" ? (
            <TriggersStep provider={provider} choices={choices} options={options} update={update} />
          ) : step === "delivery" ? (
            <DeliveryStep provider={provider} fullName={fullName} analysis={analysis} options={options} update={update} primaryBuild={primaryBuild} />
          ) : (
            <ReviewStep
              provider={provider}
              result={result}
              updating={updating}
              confirmReplace={confirmReplace}
              onConfirmReplace={setConfirmReplace}
              writing={write.isPending}
              onWrite={() => result && write.mutate(result)}
            />
          )}

          <div className="flex items-center justify-between pt-1">
            <Button variant="ghost" onClick={() => setStep(WIZARD_STEPS[index - 1].id)} disabled={index === 0}>
              <ChevronLeft /> Précédent
            </Button>
            {index < WIZARD_STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => setStep(WIZARD_STEPS[index + 1].id)} disabled={step === "analyse" && detection.stacks.length > 0 && enabledStacks.length === 0}>
                Suivant <ChevronRight />
              </Button>
            ) : null}
          </div>
        </div>

        {/* Aperçu en direct */}
        <PreviewPanel result={result} updating={updating} error={preview.error} />
      </div>
    </div>
  );
}

type Update = (change: (draft: PipelineOptions) => void) => void;

/* -------------------------------------------------------------------------- */
/* Étape 1 : analyse                                                          */
/* -------------------------------------------------------------------------- */

function AnalyseStep({ analysis, options, update }: { analysis: ProjectAnalysis; options: PipelineOptions; update: Update }) {
  const { detection } = analysis;
  return (
    <>
      <StepIntro title="Ce que contient votre projet" description="Détecté à partir des fichiers du clone local, sans rien exécuter. Désactivez une stack pour l'exclure du pipeline." />

      {detection.stacks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ScanSearch />}
            title="Aucune stack reconnue"
            description="Easy CI reconnaît Node.js, Python, Go, Rust, Java/Kotlin, Android, PHP, Ruby et .NET. Vous pouvez tout de même générer un squelette et ajouter vos commandes dans l'éditeur."
          />
        </Card>
      ) : (
        detection.stacks.map((stack, position) => {
          const stackOptions = options.stacks[position];
          return (
            <Card key={`${stack.id}:${stack.directory}`} className={cn("p-4 transition-opacity", !stackOptions.enabled && "opacity-60")}>
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent-soft text-accent">
                  <Layers className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[14.5px] font-semibold">{stack.label}</h3>
                    {stack.framework ? <Badge className="border-accent/25 bg-accent-soft text-fg">{stack.framework}</Badge> : null}
                    {stack.workspace ? <Badge>monorepo</Badge> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-muted">
                    <Fact icon={<Package />}>{stack.package_manager ?? "—"}</Fact>
                    <Fact icon={<Blocks />}>
                      version {stack.version}
                      <span className="text-fg-subtle">{stack.version_source ? ` (${stack.version_source})` : " (par défaut)"}</span>
                    </Fact>
                    <Fact icon={<FolderTree />}>
                      <code className="font-mono">{stack.directory === "." ? "racine" : `${stack.directory}/`}</code>
                    </Fact>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {stack.evidence.map((file) => (
                      <code key={file} className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
                        {file}
                      </code>
                    ))}
                  </div>
                </div>
                <Switch
                  checked={stackOptions.enabled}
                  label={`Inclure ${stack.label}`}
                  onChange={(value) =>
                    update((draft) => {
                      draft.stacks[position].enabled = value;
                    })
                  }
                />
              </div>
            </Card>
          );
        })
      )}

      <div className="grid gap-3 @lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <Container className="size-4 text-fg-subtle" /> Docker
          </div>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            {detection.docker ? (
              <>
                <code className="font-mono text-fg">{detection.docker.dockerfile}</code> trouvé{detection.docker.compose ? ", avec un fichier Compose" : ""}. Construction d'image
                activable à l'étape Livraison.
              </>
            ) : (
              "Aucun Dockerfile détecté."
            )}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <Rocket className="size-4 text-fg-subtle" /> Hébergement
          </div>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            {detection.deploy_hints.length ? (
              <>Indices : {detection.deploy_hints.map((hint) => `${hint.label} (${hint.file})`).join(", ")}.</>
            ) : (
              "Aucun fichier de plateforme d'hébergement reconnu."
            )}
          </p>
        </Card>
      </div>

      {detection.existing_ci.length ? (
        <Notice tone="warning" icon={<TriangleAlert />}>
          Ce projet contient déjà une configuration CI : {detection.existing_ci.map((path) => <code key={path} className="mx-0.5 font-mono text-fg">{path}</code>)}. Le fichier généré
          s'y ajoute, ou le remplace s'il porte le même nom (confirmation demandée).
        </Notice>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Étape 2 : étapes du pipeline                                               */
/* -------------------------------------------------------------------------- */

function StepsStep({ provider, choices, options, update }: { provider: ProviderId; choices: PipelineChoices; options: PipelineOptions; update: Update }) {
  const stacks = options.stacks.map((stack, position) => ({ stack, position })).filter(({ stack }) => stack.enabled);
  return (
    <>
      <StepIntro title="Étapes exécutées" description="Commandes pré-remplies d'après vos scripts et fichiers de configuration. Modifiez-les librement : l'aperçu se met à jour en direct." />

      {stacks.length === 0 ? (
        <Card className="p-5 text-[13px] text-fg-muted">Aucune stack incluse : le pipeline contiendra un job d'exemple à compléter.</Card>
      ) : null}

      {stacks.map(({ stack, position }) => (
        <StackStepsCard key={`${stack.id}:${stack.directory}`} provider={provider} choices={choices} stack={stack} position={position} update={update} />
      ))}

      <Card className="divide-y divide-line">
        <OptionRow
          icon={<Package />}
          title="Cache des dépendances"
          description="Réutilise les paquets téléchargés d'une exécution à l'autre : pipelines nettement plus rapides."
          control={<Switch checked={options.cache} label="Cache" onChange={(value) => update((draft) => void (draft.cache = value))} />}
        />
        {choices.supports.os_matrix ? (
          <OptionRow
            icon={<Monitor />}
            title="Systèmes pour les tests"
            description="Exécute les tests sur chaque système coché (utile pour une app ou une bibliothèque multiplateforme)."
            control={
              <div className="flex gap-1">
                {choices.os.map((os) => {
                  const active = options.os.includes(os.id);
                  return (
                    <button
                      key={os.id}
                      onClick={() =>
                        update((draft) => {
                          const next = active ? draft.os.filter((id) => id !== os.id) : [...draft.os, os.id];
                          draft.os = next.length ? next : draft.os;
                        })
                      }
                      className={cn(
                        "h-7 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors",
                        active ? "border-accent/40 bg-accent-soft text-fg" : "border-line text-fg-muted hover:bg-surface-2",
                      )}
                    >
                      {os.label}
                    </button>
                  );
                })}
              </div>
            }
          />
        ) : null}
      </Card>
    </>
  );
}

function StackStepsCard({ provider, choices, stack, position, update }: { provider: ProviderId; choices: PipelineChoices; stack: StackOptions; position: number; update: Update }) {
  const set = (change: (draft: StackOptions) => void) => update((draft) => change(draft.stacks[position]));
  const label = choices.stack_labels[stack.id] ?? stack.id;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/40 px-4 py-2.5">
        <Layers className="size-4 text-accent" />
        <h3 className="text-[13.5px] font-semibold">{label}</h3>
        {stack.directory !== "." ? <code className="font-mono text-[12px] text-fg-muted">{stack.directory}/</code> : null}
      </div>
      <div className="space-y-3 p-4">
        <div className="grid gap-3 @lg:grid-cols-[140px_minmax(0,1fr)]">
          <Field label="Version">
            <Input value={stack.version} onChange={(event) => set((draft) => void (draft.version = event.target.value))} className="[&_input]:font-mono [&_input]:text-[12.5px]" />
          </Field>
          <Field label="Tester plusieurs versions" hint={provider === "bitbucket" ? "une étape par version" : "matrice, séparées par des virgules"}>
            <ListInput values={stack.matrix} placeholder={`ex. ${stack.version}, …`} onChange={(values) => set((draft) => void (draft.matrix = values))} />
          </Field>
        </div>
        <Field label="Installation des dépendances">
          <Input value={stack.install} placeholder="aucune" onChange={(event) => set((draft) => void (draft.install = event.target.value))} className="font-mono [&_input]:font-mono [&_input]:text-[12.5px]" />
        </Field>
        <div className="space-y-1.5">
          {STEP_ORDER.map((stepId) => {
            const value = stack.steps[stepId];
            return (
              <div key={stepId} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors", value.enabled ? "border-line bg-surface" : "border-dashed border-line bg-transparent")}>
                <Switch checked={value.enabled} label={choices.step_labels[stepId]} onChange={(enabled) => set((draft) => void (draft.steps[stepId].enabled = enabled))} />
                <div className="w-36 shrink-0">
                  <div className="text-[13px] font-medium">{choices.step_labels[stepId]}</div>
                  <div className="text-[11.5px] text-fg-subtle">{STEP_HINTS[stepId]}</div>
                </div>
                <Input
                  value={value.command}
                  disabled={!value.enabled}
                  placeholder="commande à exécuter"
                  onChange={(event) => set((draft) => void (draft.steps[stepId].command = event.target.value))}
                  className={cn("min-w-0 flex-1 [&_input]:font-mono [&_input]:text-[12.5px]", !value.enabled && "opacity-50")}
                />
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Étape 3 : déclencheurs                                                     */
/* -------------------------------------------------------------------------- */

function TriggersStep({ provider, choices, options, update }: { provider: ProviderId; choices: PipelineChoices; options: PipelineOptions; update: Update }) {
  const triggers = options.triggers;
  const setTrigger = <K extends keyof PipelineOptions["triggers"]>(name: K, value: PipelineOptions["triggers"][K]) => update((draft) => void (draft.triggers[name] = value));
  const customSchedule = triggers.schedule !== "" && !SCHEDULES.some((s) => s.value === triggers.schedule);
  const [scheduleMode, setScheduleMode] = useState(customSchedule ? "custom" : triggers.schedule);
  const prLabel = provider === "gitlab" ? "Merge requests" : "Pull requests";

  return (
    <>
      <StepIntro title="Quand le pipeline s'exécute" description="Les déclencheurs habituels sont déjà cochés : chaque push sur la branche principale et chaque proposition de modification." />
      <Card className="divide-y divide-line">
        <OptionRow
          icon={<GitBranch />}
          title="Push sur la branche principale"
          description="Vérifie chaque modification intégrée."
          control={
            <div className="flex items-center gap-2">
              <Input value={options.default_branch} onChange={(event) => update((draft) => void (draft.default_branch = event.target.value))} className="w-32 [&_input]:font-mono [&_input]:text-[12.5px]" aria-label="Branche principale" disabled={provider === "gitlab"} />
              <Switch checked={triggers.push_default} label="Push" onChange={(value) => setTrigger("push_default", value)} />
            </div>
          }
        />
        <OptionRow
          icon={<GitPullRequest />}
          title={prLabel}
          description={`Vérifie les ${prLabel.toLowerCase()} avant la fusion.`}
          control={<Switch checked={triggers.pull_requests} label={prLabel} onChange={(value) => setTrigger("pull_requests", value)} />}
        />
        <OptionRow icon={<Tag />} title="Tags de version (v*)" description="Par exemple v1.4.0 : utile pour publier une release." control={<Switch checked={triggers.tags} label="Tags" onChange={(value) => setTrigger("tags", value)} />} />
        <OptionRow
          icon={<Hand />}
          title="Lancement manuel"
          description={provider === "github" ? "Bouton « Run workflow » sur GitHub." : provider === "gitlab" ? "Bouton « Run pipeline » sur GitLab." : "Pipeline personnalisé « run-ci » sur Bitbucket."}
          control={<Switch checked={triggers.manual} label="Manuel" onChange={(value) => setTrigger("manual", value)} />}
        />
        <OptionRow
          icon={<Clock />}
          title="Exécution planifiée"
          description={choices.supports.schedule_in_file ? "Syntaxe cron, en heure UTC." : "La planification se crée ensuite dans l'interface de la plateforme (indiqué dans les notes)."}
          control={
            <div className="flex items-center gap-2">
              {scheduleMode === "custom" ? (
                <Input value={triggers.schedule} placeholder="*/30 * * * *" onChange={(event) => setTrigger("schedule", event.target.value)} className="w-32 [&_input]:font-mono [&_input]:text-[12.5px]" aria-label="Expression cron" />
              ) : null}
              <select
                value={scheduleMode}
                onChange={(event) => {
                  setScheduleMode(event.target.value);
                  if (event.target.value !== "custom") setTrigger("schedule", event.target.value);
                }}
                className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-fg outline-none focus:border-accent/60"
              >
                {SCHEDULES.map((schedule) => (
                  <option key={schedule.value} value={schedule.value}>
                    {schedule.label}
                  </option>
                ))}
                <option value="custom">Personnalisée…</option>
              </select>
            </div>
          }
        />
      </Card>

      <Card className="divide-y divide-line">
        {choices.supports.concurrency ? (
          <OptionRow
            icon={<Zap />}
            title="Annuler les exécutions dépassées"
            description="Un nouveau push sur la même branche interrompt l'exécution précédente, devenue inutile."
            control={<Switch checked={options.concurrency} label="Annulation" onChange={(value) => update((draft) => void (draft.concurrency = value))} />}
          />
        ) : null}
        <OptionRow
          icon={<FileCode2 />}
          title="Fichier"
          description={choices.path_editable ? "Un dépôt GitHub peut contenir plusieurs workflows." : `${PROVIDER_LABELS[provider].label} lit uniquement ce fichier.`}
          control={
            choices.path_editable ? (
              <Input value={options.path} onChange={(event) => update((draft) => void (draft.path = event.target.value))} className="w-72 [&_input]:font-mono [&_input]:text-[12.5px]" aria-label="Chemin du fichier" />
            ) : (
              <code className="font-mono text-[12.5px] text-fg">{options.path}</code>
            )
          }
        />
      </Card>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Étape 4 : livraison                                                        */
/* -------------------------------------------------------------------------- */

function DeliveryStep({ provider, fullName, analysis, options, update, primaryBuild }: { provider: ProviderId; fullName: string; analysis: ProjectAnalysis; options: PipelineOptions; update: Update; primaryBuild: string | null }) {
  const { docker, deploy } = options;
  const { detection, choices } = analysis;
  const primaryStack = options.stacks.find((s) => s.enabled);
  const presets = detection.deploy_hints.filter((hint) => DEPLOY_PRESETS[hint.id]);

  return (
    <>
      <StepIntro title="Image Docker et déploiement" description="Facultatif. Ces jobs ne s'exécutent qu'après la réussite des vérifications, et seulement sur la branche principale ou les tags choisis." />

      <Card className="overflow-hidden">
        <OptionRow
          icon={<Container />}
          title="Construire une image Docker"
          description={detection.docker ? `À partir de ${detection.docker.dockerfile}.` : "Aucun Dockerfile détecté : ajoutez-en un avant d'activer ce job."}
          control={<Switch checked={docker.enabled} label="Docker" onChange={(value) => update((draft) => void (draft.docker.enabled = value))} />}
        />
        {docker.enabled ? (
          <div className="grid gap-3 border-t border-line bg-surface-2/30 p-4 @xl:grid-cols-2 animate-fade-in">
            <Field label="Dockerfile">
              <Input value={docker.dockerfile} onChange={(event) => update((draft) => void (draft.docker.dockerfile = event.target.value))} className="[&_input]:font-mono [&_input]:text-[12.5px]" />
            </Field>
            <Field label="Contexte de build">
              <Input value={docker.context} onChange={(event) => update((draft) => void (draft.docker.context = event.target.value))} className="[&_input]:font-mono [&_input]:text-[12.5px]" />
            </Field>
            {choices.registries.length > 1 ? (
              <Field label="Registre">
                <select
                  value={docker.registry}
                  onChange={(event) =>
                    update((draft) => {
                      draft.docker.registry = event.target.value;
                      if (event.target.value === "ghcr") draft.docker.image = `ghcr.io/${fullName.toLowerCase()}`;
                      if (event.target.value === "gitlab") draft.docker.image = "$CI_REGISTRY_IMAGE";
                      if (event.target.value === "dockerhub") draft.docker.image = `docker.io/${fullName.toLowerCase().split("/").pop()}`;
                    })
                  }
                  className="h-8 w-full rounded-lg border border-line bg-surface px-2 text-[13px] text-fg outline-none focus:border-accent/60"
                >
                  {choices.registries.map((registry) => (
                    <option key={registry.id} value={registry.id}>
                      {registry.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Nom de l'image">
              <Input value={docker.image} onChange={(event) => update((draft) => void (draft.docker.image = event.target.value))} className="[&_input]:font-mono [&_input]:text-[12.5px]" />
            </Field>
            <Field label="Construire pour">
              <SegmentedControl<DeliveryWhen> className="[&>button]:whitespace-nowrap" value={docker.when} onChange={(value) => update((draft) => void (draft.docker.when = value))} options={WHEN_OPTIONS} />
            </Field>
            <Field label="Envoyer au registre">
              <div className="flex h-8 items-center gap-2 text-[12.5px] text-fg-muted">
                <Switch checked={docker.push} label="Envoyer" onChange={(value) => update((draft) => void (draft.docker.push = value))} />
                {docker.push ? "build + push" : "build uniquement (vérification)"}
              </div>
            </Field>
          </div>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        <OptionRow
          icon={<Rocket />}
          title="Déployer"
          description="Exécute votre commande de déploiement dans un environnement dédié."
          control={<Switch checked={deploy.enabled} label="Déploiement" onChange={(value) => update((draft) => void (draft.deploy.enabled = value))} />}
        />
        {deploy.enabled ? (
          <div className="space-y-3 border-t border-line bg-surface-2/30 p-4 animate-fade-in">
            {presets.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-fg-muted">Modèles détectés :</span>
                {presets.map((hint) => (
                  <Button
                    key={hint.id}
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      update((draft) => {
                        const preset = DEPLOY_PRESETS[hint.id];
                        draft.deploy.command = preset.command(primaryBuild);
                        draft.deploy.secrets = preset.secrets;
                      })
                    }
                  >
                    <Rocket className="size-3.5" /> {hint.label}
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="grid gap-3 @lg:grid-cols-[180px_minmax(0,1fr)]">
              <Field label="Environnement">
                <Input value={deploy.environment} onChange={(event) => update((draft) => void (draft.deploy.environment = event.target.value))} className="[&_input]:font-mono [&_input]:text-[12.5px]" />
              </Field>
              <Field label="Secrets utilisés" hint="noms seulement, jamais les valeurs">
                <ListInput values={deploy.secrets} placeholder="ex. DEPLOY_TOKEN" icon={<KeyRound />} onChange={(values) => update((draft) => void (draft.deploy.secrets = values))} />
              </Field>
            </div>
            <Field label="Commande de déploiement" hint="une commande par ligne">
              <textarea
                value={deploy.command}
                onChange={(event) => update((draft) => void (draft.deploy.command = event.target.value))}
                rows={3}
                placeholder="./scripts/deploy.sh"
                spellCheck={false}
                className="scrollbar-thin w-full resize-y rounded-lg border border-line bg-surface px-2.5 py-2 font-mono text-[12.5px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60 focus:ring-3 focus:ring-accent/15"
              />
            </Field>
            <div className="grid gap-3 @xl:grid-cols-2">
              <Field label="Déployer depuis">
                <SegmentedControl<DeliveryWhen> className="[&>button]:whitespace-nowrap" value={deploy.when} onChange={(value) => update((draft) => void (draft.deploy.when = value))} options={WHEN_OPTIONS} />
              </Field>
              <Field label="Validation manuelle">
                <div className="flex h-8 items-center gap-2 text-[12.5px] text-fg-muted">
                  <Switch checked={deploy.manual} label="Validation manuelle" onChange={(value) => update((draft) => void (draft.deploy.manual = value))} />
                  {deploy.manual ? (provider === "github" ? "via les règles de l'environnement" : "bouton à cliquer sur la plateforme") : "automatique"}
                </div>
              </Field>
            </div>
            {primaryStack ? (
              <label className="flex items-center gap-2.5 text-[12.5px] text-fg-muted">
                <Switch checked={deploy.use_stack} label="Préparer l'environnement" onChange={(value) => update((draft) => void (draft.deploy.use_stack = value))} />
                Préparer l'environnement {analysis.choices.stack_labels[primaryStack.id]} (runtime et dépendances) avant la commande
              </label>
            ) : null}
          </div>
        ) : null}
      </Card>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Étape 5 : vérification                                                     */
/* -------------------------------------------------------------------------- */

function ReviewStep({
  provider,
  result,
  updating,
  confirmReplace,
  onConfirmReplace,
  writing,
  onWrite,
}: {
  provider: ProviderId;
  result: GeneratedPipeline | undefined;
  updating: boolean;
  confirmReplace: boolean;
  onConfirmReplace: (value: boolean) => void;
  writing: boolean;
  onWrite: () => void;
}) {
  if (!result) return <Skeleton className="h-40 w-full rounded-xl" />;
  const summary = result.summary;
  const groups = summary.stages.length ? summary.stages.map((stage) => ({ stage, jobs: summary.jobs.filter((job) => job.stage === stage) })) : [{ stage: null, jobs: summary.jobs }];
  const blocked = result.validation.errors > 0 || (result.exists && !confirmReplace);

  return (
    <>
      <StepIntro title="Vérifier avant d'écrire" description={`Le fichier sera écrit dans votre dossier local${result.branch ? `, sur la branche ${result.branch}` : ""}. Rien n'est commité ni envoyé à ${PROVIDER_LABELS[provider].label} à cette étape.`} />

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
          <ListChecks className="size-4 text-fg-subtle" /> {summary.jobs.length} job{summary.jobs.length > 1 ? "s" : ""}
          {summary.stages.length ? <span className="font-normal text-fg-muted">en {summary.stages.length} étapes</span> : null}
        </div>
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.stage ?? "jobs"}>
              {group.stage ? <div className="mb-1 font-mono text-[11.5px] text-fg-subtle">{group.stage}</div> : null}
              <div className="grid gap-1.5 @lg:grid-cols-2">
                {group.jobs.map((job) => (
                  <div key={job.id} className="rounded-lg border border-line bg-surface-2/40 px-2.5 py-1.5">
                    <div className="truncate text-[12.5px] font-medium">{readable(job.name)}</div>
                    <div className="truncate text-[11.5px] text-fg-subtle">
                      {[job.runs_on && readable(job.runs_on), `${job.steps} commande${job.steps > 1 ? "s" : ""}`, job.needs.length ? `après ${job.needs.join(", ")}` : null, job.matrix ? "matrice" : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {result.notes.length ? (
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
            <Info className="size-4 text-accent" /> À faire sur la plateforme
          </div>
          <ul className="space-y-1.5">
            {result.notes.map((note) => (
              <li key={note} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-fg-muted">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-fg-subtle" />
                {note}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {result.validation.errors ? (
        <Notice tone="error" icon={<CircleAlert />}>
          La validation signale {result.validation.errors} erreur{result.validation.errors > 1 ? "s" : ""} : vérifiez les commandes et chemins saisis.
        </Notice>
      ) : null}

      {result.exists ? (
        <Notice tone="warning" icon={<TriangleAlert />}>
          <div>
            <code className="font-mono text-fg">{result.path}</code> existe déjà dans le dossier local : il sera remplacé. L'ancienne version reste récupérable avec « Restaurer » dans
            l'éditeur tant que vous n'avez pas commité.
            <label className="mt-2 flex items-center gap-2 font-medium text-fg">
              <input type="checkbox" checked={confirmReplace} onChange={(event) => onConfirmReplace(event.target.checked)} className="size-4 accent-[var(--accent)]" />
              Remplacer le fichier existant
            </label>
          </div>
        </Notice>
      ) : null}

      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg-muted">
          <div className="text-[13px] font-medium text-fg">Et ensuite ?</div>
          Relecture dans l'éditeur, commit sur une branche locale, puis envoi et pull request uniquement quand vous le décidez.
        </div>
        <Button variant="primary" size="lg" onClick={onWrite} loading={writing} disabled={blocked || updating}>
          <FileCheck2 /> Écrire dans le dossier local
        </Button>
      </Card>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Aperçu                                                                     */
/* -------------------------------------------------------------------------- */

function PreviewPanel({ result, updating, error }: { result: GeneratedPipeline | undefined; updating: boolean; error: Error | null }) {
  const [copied, setCopied] = useState(false);
  const errors = result?.validation.errors ?? 0;
  const warnings = result?.validation.warnings ?? 0;
  const lines = useMemo(() => result?.content.split("\n").length ?? 0, [result?.content]);

  return (
    <Card className="sticky top-4 flex h-[calc(100vh-190px)] min-h-[420px] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <FileCode2 className="size-4 shrink-0 text-fg-subtle" />
        <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{result?.path ?? "…"}</code>
        {result?.exists ? <Badge className="border-running/30 bg-running/10 text-fg">remplace l'existant</Badge> : result ? <Badge className="border-accent/25 bg-accent-soft text-fg">nouveau</Badge> : null}
        <span
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium",
            !result ? "bg-surface-2" : errors ? "bg-failure/12" : warnings ? "bg-running/12" : "bg-success/12",
          )}
        >
          {updating || !result ? (
            <Spinner className="size-3" />
          ) : errors ? (
            <CircleAlert className="size-3.5 text-failure" />
          ) : warnings ? (
            <TriangleAlert className="size-3.5 text-running" />
          ) : (
            <CircleCheck className="size-3.5 text-success" />
          )}
          {!result ? "Génération" : errors ? `${errors} erreur${errors > 1 ? "s" : ""}` : warnings ? `${warnings} avert.` : "Valide"}
        </span>
        <Tooltip content={copied ? "Copié" : "Copier le YAML"}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copier"
            disabled={!result}
            onClick={() => {
              if (!result) return;
              void navigator.clipboard.writeText(result.content).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>
        </Tooltip>
      </div>
      <div className="relative min-h-0 flex-1 bg-log">
        {error && !result ? (
          <p className="p-4 text-[12.5px] text-failure">{errorMessage(error)}</p>
        ) : result ? (
          <YamlViewer content={result.content} />
        ) : (
          <div className="space-y-2.5 p-5">
            <Skeleton className="w-1/2" />
            <Skeleton className="w-2/3" />
            <Skeleton className="w-1/3" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3.5 py-2 text-[11.5px] text-fg-subtle">
        {error && result ? <span className="truncate text-failure">{errorMessage(error)}</span> : <span>Aperçu en direct · {lines} lignes</span>}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Petits composants                                                          */
/* -------------------------------------------------------------------------- */

/** « Tests (${{ matrix.version }}) » → « Tests (version) » : plus lisible dans le récapitulatif. */
function readable(text: string) {
  return text.replace(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, "$1");
}

function StepIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-0.5">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">{description}</p>
    </div>
  );
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:text-fg-subtle">
      {icon}
      {children}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline gap-2 text-[12px] font-medium text-fg-muted">
        {label}
        {hint ? <span className="font-normal text-fg-subtle">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function OptionRow({ icon, title, description, control }: { icon: ReactNode; title: string; description: string; control: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-muted [&_svg]:size-4">{icon}</div>
      <div className="min-w-48 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="text-[12px] leading-snug text-fg-muted">{description}</div>
      </div>
      {control}
    </div>
  );
}

function Notice({ tone, icon, children }: { tone: "warning" | "error"; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border p-3.5 text-[12.5px] leading-relaxed text-fg-muted [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
        tone === "error" ? "border-failure/30 bg-failure/[0.06] [&>svg]:text-failure" : "border-running/30 bg-running/[0.07] [&>svg]:text-running",
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Liste saisie sous forme de texte séparé par des virgules ; le texte brut est conservé pendant la frappe. */
function ListInput({ values, onChange, placeholder, icon }: { values: string[]; onChange: (values: string[]) => void; placeholder?: string; icon?: ReactNode }) {
  const [text, setText] = useState(values.join(", "));
  useEffect(() => {
    const parsed = text.split(",").map((v) => v.trim()).filter(Boolean);
    if (parsed.join("|") !== values.join("|")) setText(values.join(", "));
  }, [values]);
  return (
    <Input
      value={text}
      icon={icon}
      placeholder={placeholder}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value.split(",").map((v) => v.trim()).filter(Boolean));
      }}
      className="[&_input]:font-mono [&_input]:text-[12.5px]"
    />
  );
}
