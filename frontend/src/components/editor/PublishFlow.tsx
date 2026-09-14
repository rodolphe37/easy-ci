import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpFromLine, Check, CircleAlert, ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, Loader, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import i18n from "@/i18n";
import { CiStateBadge } from "@/components/local/LocalProjectPanel";
import { errorMessage } from "@/hooks/local";
import { api } from "@/lib/api";
import { PROVIDER_LABELS } from "@/lib/providers";
import type { LocalStatus, ProviderId, Publication } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Modal } from "../ui/overlays";
import { Badge, Button, Input, SegmentedControl, Switch } from "../ui/primitives";

type LinkedStatus = Extract<LocalStatus, { linked: true }>;

/** Rafraîchit tout ce qui dépend de l'état Git local après une action. */
function useRefreshLocal(key: string) {
  const queryClient = useQueryClient();
  return (status?: LocalStatus) => {
    if (status) queryClient.setQueryData(["local-status", key], status);
    void queryClient.invalidateQueries({ queryKey: ["local-status", key] });
    void queryClient.invalidateQueries({ queryKey: ["publication", key] });
    void queryClient.invalidateQueries({ queryKey: ["local-diff", key] });
  };
}

export function usePublication(key: string, enabled = true) {
  return useQuery({ queryKey: ["publication", key], queryFn: () => api.getPublication(key), enabled, staleTime: 15_000 });
}

/* -------------------------------------------------------------------------- */
/* Commit local                                                                */
/* -------------------------------------------------------------------------- */

export function CommitDialog({
  open,
  onOpenChange,
  repoKey,
  status,
  focusPath,
  blockedReason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoKey: string;
  status: LinkedStatus;
  focusPath?: string | null;
  /** Erreurs de validation dans le fichier : le commit est déconseillé. */
  blockedReason?: string | null;
}) {
  const refresh = useRefreshLocal(repoKey);
  const candidates = (status.ci_files ?? []).filter((file) => file.state === "uncommitted" || file.state === "untracked");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [branchMode, setBranchMode] = useState<"new" | "current">("new");
  const [branch, setBranch] = useState("");
  const [override, setOverride] = useState(false);

  const suggestion = useQuery({
    queryKey: ["branch-suggestion", repoKey, focusPath],
    queryFn: () => api.branchSuggestion(repoKey, focusPath ?? undefined),
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (!open) return;
    const initial = focusPath && candidates.some((c) => c.path === focusPath) ? [focusPath] : candidates.map((c) => c.path);
    setSelected(initial);
    const name = (focusPath ?? initial[0] ?? "ci").split("/").pop();
    setMessage(i18n.t("publish.commit.defaultMessage", { name }));
    setOverride(false);
  }, [open]);

  useEffect(() => {
    if (!suggestion.data) return;
    setBranch(suggestion.data.suggested);
    // Sur la branche par défaut, on propose une branche dédiée ; sinon on reste sur la branche de travail.
    setBranchMode(suggestion.data.on_default_branch ? "new" : "current");
  }, [suggestion.data]);

  const commit = useMutation({
    mutationFn: () => api.commitCi(repoKey, selected, message, branchMode === "new" ? branch : null),
    onSuccess: (result) => {
      refresh(result.status);
      toast.success(i18n.t("publish.commit.created"), {
        description: i18n.t("publish.commit.createdDescription", { sha: result.sha.slice(0, 7), branch: result.status.linked ? result.status.branch : "" }),
      });
      onOpenChange(false);
    },
  });

  const onDefault = suggestion.data?.on_default_branch ?? false;
  const blocked = Boolean(blockedReason) && !override;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={i18n.t("publish.commit.title")} description={i18n.t("publish.commit.description")} className="w-[min(600px,calc(100vw-48px))]">
      <form
        className="space-y-4 px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocked) commit.mutate();
        }}
      >
        <Field label={i18n.t("publish.commit.files")}>
          {candidates.length === 0 ? (
            <p className="text-[12.5px] text-fg-muted">{i18n.t("publish.commit.noFiles")}</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {candidates.map((file) => (
                <li key={file.path}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent)]"
                      checked={selected.includes(file.path)}
                      onChange={(event) => setSelected((prev) => (event.target.checked ? [...prev, file.path] : prev.filter((p) => p !== file.path)))}
                    />
                    <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{file.path}</code>
                    <CiStateBadge state={file.state} />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Field>

        <Field label={i18n.t("publish.commit.message")} htmlFor="commit-message">
          <textarea
            id="commit-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12.5px] text-fg outline-none focus:border-accent/60 focus:ring-3 focus:ring-accent/15"
          />
        </Field>

        <Field label={i18n.t("publish.commit.branch")}>
          <SegmentedControl<"new" | "current">
            value={branchMode}
            onChange={setBranchMode}
            options={[
              { value: "new", label: <><Plus />{i18n.t("publish.commit.newBranch")}</> },
              { value: "current", label: <><GitBranch />{status.branch ? i18n.t("publish.commit.currentBranchNamed", { branch: status.branch }) : i18n.t("publish.commit.currentBranch")}</> },
            ]}
          />
          {branchMode === "new" ? (
            <Input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              icon={<GitBranch />}
              className="mt-2 h-9 [&_input]:font-mono [&_input]:text-[12.5px]"
              spellCheck={false}
              placeholder={i18n.t("publish.commit.branchPlaceholder")}
            />
          ) : onDefault ? (
            <p className="mt-2 flex items-start gap-2 text-[12.5px] text-running">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {i18n.t("publish.commit.onDefault", { branch: suggestion.data?.default_branch })}
            </p>
          ) : null}
        </Field>

        {blockedReason ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-failure/30 bg-failure/[0.06] p-3 text-[12.5px] text-fg-muted">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-failure" />
            <div>
              {blockedReason}
              <label className="mt-2 flex items-center gap-2 text-fg">
                <Switch label={i18n.t("publish.commit.override")} checked={override} onChange={setOverride} /> {i18n.t("publish.commit.override")}
              </label>
            </div>
          </div>
        ) : null}

        {commit.error ? <p className="text-[12.5px] text-failure">{errorMessage(commit.error)}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {i18n.t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={commit.isPending}
            disabled={blocked || !selected.length || !message.trim() || (branchMode === "new" && !branch.trim())}
          >
            <GitCommitHorizontal /> {i18n.t("publish.commit.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Envoi & pull request                                                        */
/* -------------------------------------------------------------------------- */

export function PushDialog({ open, onOpenChange, repoKey, status }: { open: boolean; onOpenChange: (open: boolean) => void; repoKey: string; status: LinkedStatus }) {
  const refresh = useRefreshLocal(repoKey);
  const push = useMutation({
    mutationFn: () => api.pushLocalBranch(repoKey),
    onSuccess: (result) => {
      refresh(result.status);
      toast.success(i18n.t("publish.push.done"), { description: `${result.branch} → ${result.remote}` });
      onOpenChange(false);
    },
  });
  const ahead = status.ahead ?? 0;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={i18n.t("publish.push.title")} description={i18n.t("publish.push.description")}>
      <div className="space-y-4 px-5 py-4">
        <div className="rounded-xl border border-line bg-surface-2/50 p-3.5 text-[13px]">
          <div className="flex items-center gap-2">
            <GitBranch className="size-4 text-fg-subtle" />
            <code className="font-mono text-fg">{status.branch}</code>
          </div>
          <p className="mt-1.5 text-fg-muted">
            {status.upstream
              ? i18n.t("publish.push.ahead", { count: ahead, upstream: status.upstream })
              : i18n.t("publish.push.newBranch")}
          </p>
          {status.dirty ? (
            <p className="mt-1.5 text-[12.5px] text-running">{i18n.t("publish.push.dirty")}</p>
          ) : null}
        </div>
        {push.error ? <p className="text-[12.5px] text-failure">{errorMessage(push.error)}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {i18n.t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => push.mutate()} loading={push.isPending}>
            <ArrowUpFromLine /> {i18n.t("publish.push.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function PullRequestDialog({
  open,
  onOpenChange,
  repoKey,
  provider,
  publication,
  defaultTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoKey: string;
  provider: ProviderId;
  publication: Publication;
  defaultTitle: string;
}) {
  const refresh = useRefreshLocal(repoKey);
  const label = provider === "gitlab" ? "merge request" : "pull request";
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState("");
  const [base, setBase] = useState(publication.default_branch ?? "");
  const [draft, setDraft] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setBase(publication.default_branch ?? "");
    setBody(i18n.t("publish.pr.defaultBody", { branch: publication.branch }));
    setDraft(false);
  }, [open]);

  const create = useMutation({
    mutationFn: () => api.createPullRequest(repoKey, title, body, base || null, draft),
    onSuccess: (pull) => {
      refresh();
      toast.success(pull.already_existed ? i18n.t("publish.pr.alreadyOpen", { label: pull.label }) : i18n.t("publish.pr.created", { label: pull.label }), {
        description: `#${pull.number} · ${pull.title}`,
        action: { label: i18n.t("common.open"), onClick: () => void api.openExternal(pull.url) },
      });
      onOpenChange(false);
    },
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={i18n.t("publish.pr.title", { kind: label })}
      description={i18n.t("publish.pr.description", { provider: PROVIDER_LABELS[provider].label, branch: publication.branch })}
      className="w-[min(600px,calc(100vw-48px))]"
    >
      <form
        className="space-y-4 px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Field label={i18n.t("publish.pr.titleField")} htmlFor="pr-title">
          <Input id="pr-title" value={title} onChange={(event) => setTitle(event.target.value)} className="h-9" />
        </Field>
        <Field label={i18n.t("publish.pr.body")} htmlFor="pr-body">
          <textarea
            id="pr-body"
            rows={5}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-fg outline-none focus:border-accent/60 focus:ring-3 focus:ring-accent/15"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={i18n.t("publish.pr.base")} htmlFor="pr-base">
            <Input id="pr-base" value={base} onChange={(event) => setBase(event.target.value)} icon={<GitBranch />} className="h-9 [&_input]:font-mono [&_input]:text-[12.5px]" />
          </Field>
          <Field label={i18n.t("publish.pr.draft")}>
            <label className="flex h-9 items-center gap-2.5 text-[13px] text-fg-muted">
              <Switch label={i18n.t("publish.pr.draft")} checked={draft} onChange={setDraft} />
              {draft ? i18n.t("publish.pr.isDraft") : i18n.t("publish.pr.ready")}
            </label>
          </Field>
        </div>
        {create.error ? <p className="text-[12.5px] text-failure">{errorMessage(create.error)}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {i18n.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!title.trim() || !base.trim()}>
            <GitPullRequest /> {i18n.t("publish.pr.submit", { kind: label })}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Carte « Branche et publication »                                            */
/* -------------------------------------------------------------------------- */

/** Parcours en 3 temps, toujours à l'initiative de l'utilisateur : commit local → envoi → pull request. */
export function PublicationCard({
  repoKey,
  provider,
  status,
  compact,
  onCommit,
}: {
  repoKey: string;
  provider: ProviderId;
  status: LinkedStatus;
  compact?: boolean;
  onCommit?: () => void;
}) {
  const publication = usePublication(repoKey).data;
  const [pushOpen, setPushOpen] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const uncommitted = (status.ci_files ?? []).filter((file) => file.state === "uncommitted" || file.state === "untracked").length;
  const ahead = status.ahead ?? 0;
  const pushed = Boolean(status.upstream) && ahead === 0;
  const pull = publication?.pull_request;
  const onDefault = publication?.default_branch && status.branch === publication.default_branch;
  const label = provider === "gitlab" ? "Merge request" : "Pull request";

  const steps: { title: string; done: boolean; active: boolean; detail: ReactNode; action?: ReactNode }[] = [
    {
      title: i18n.t("publish.card.commit"),
      done: uncommitted === 0 && (ahead > 0 || pushed),
      active: uncommitted > 0,
      detail: uncommitted > 0 ? i18n.t("publish.card.filesToCommit", { count: uncommitted }) : ahead > 0 ? i18n.t("publish.card.commitsWaiting", { count: ahead }) : i18n.t("publish.card.nothingPending"),
      action: onCommit && uncommitted > 0 ? (
        <Button size="sm" variant="primary" onClick={onCommit}>
          <GitCommitHorizontal className="size-3.5" /> {i18n.t("publish.card.commitButton")}
        </Button>
      ) : null,
    },
    {
      title: i18n.t("publish.card.push"),
      done: pushed,
      active: ahead > 0 || (!status.upstream && Boolean(status.last_commit)),
      detail: pushed ? i18n.t("publish.card.upToDate", { upstream: status.upstream }) : status.upstream ? i18n.t("publish.card.commitsToPush", { count: ahead }) : i18n.t("publish.card.notPushed"),
      action:
        ahead > 0 || !status.upstream ? (
          <Button size="sm" variant={uncommitted === 0 ? "primary" : "secondary"} onClick={() => setPushOpen(true)}>
            <ArrowUpFromLine className="size-3.5" /> {i18n.t("publish.card.pushButton")}
          </Button>
        ) : null,
    },
    {
      title: label,
      done: Boolean(pull),
      active: pushed && !pull && !onDefault,
      detail: pull ? (
        <button className="inline-flex items-center gap-1 font-medium text-accent hover:underline" onClick={() => void api.openExternal(pull.url)}>
          #{pull.number} {pull.draft ? i18n.t("publish.card.draftSuffix") : ""} <ExternalLink className="size-3" />
        </button>
      ) : onDefault ? (
        i18n.t("publish.card.onDefault")
      ) : publication && !publication.account_connected ? (
        i18n.t("publish.card.connectToCreate", { provider: PROVIDER_LABELS[provider].label })
      ) : pushed ? (
        i18n.t("publish.card.readyToPropose")
      ) : (
        i18n.t("publish.card.afterPush")
      ),
      action:
        pushed && !pull && !onDefault && publication?.account_connected ? (
          <Button size="sm" variant="primary" onClick={() => setPullOpen(true)}>
            <GitPullRequest className="size-3.5" /> {i18n.t("publish.card.createButton")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className={cn("rounded-xl border border-line bg-surface", compact ? "p-3" : "p-4 shadow-soft")}>
      <div className="mb-3 flex items-center gap-2">
        <GitBranch className="size-4 text-fg-subtle" />
        <code className="min-w-0 truncate font-mono text-[12.5px] font-medium">{status.branch ?? i18n.t("publish.card.detached")}</code>
        {onDefault ? <Badge>{i18n.t("publish.card.defaultBranch")}</Badge> : null}
      </div>
      <ol className="space-y-2.5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                step.done ? "bg-success text-white" : step.active ? "bg-accent text-accent-fg" : "bg-surface-3 text-fg-subtle",
              )}
            >
              {step.done ? <Check className="size-3" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-[13px] font-medium", !step.done && !step.active && "text-fg-muted")}>{step.title}</div>
              <div className="text-[12px] text-fg-muted">{step.detail}</div>
            </div>
            {step.action}
          </li>
        ))}
      </ol>
      {publication?.pull_request_error ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-running">
          <Loader className="size-3" /> {publication.pull_request_error}
        </p>
      ) : null}
      <PushDialog open={pushOpen} onOpenChange={setPushOpen} repoKey={repoKey} status={status} />
      {publication ? (
        <PullRequestDialog
          open={pullOpen}
          onOpenChange={setPullOpen}
          repoKey={repoKey}
          provider={provider}
          publication={publication}
          defaultTitle={status.last_commit?.message ?? i18n.t("publish.pr.defaultTitle")}
        />
      ) : null}
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-fg-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
