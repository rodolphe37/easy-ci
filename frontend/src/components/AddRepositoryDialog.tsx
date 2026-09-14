import { FolderGit2, Info } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useRepositoryActions } from "@/hooks/repositories";
import { useScans } from "@/hooks/scans";
import { useSession } from "@/hooks/session";
import { PROVIDER_LABELS, ProviderIcon, repoKey, repoPath } from "@/lib/providers";
import type { ProviderId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Modal } from "./ui/overlays";
import { Button, Input, SegmentedControl } from "./ui/primitives";

const EXAMPLES: Record<ProviderId, string[]> = {
  github: ["vercel/next.js", "https://github.com/astral-sh/uv"],
  gitlab: ["gitlab-org/gitlab-runner", "https://gitlab.com/inkscape/inkscape"],
  bitbucket: ["atlassian/python-bitbucket", "https://bitbucket.org/workspace/depot"],
};

const PLACEHOLDERS: Record<ProviderId, string> = {
  github: "propriétaire/dépôt ou https://github.com/…",
  gitlab: "groupe/sous-groupe/projet ou URL GitLab",
  bitbucket: "workspace/dépôt ou https://bitbucket.org/…",
};

/** Plateforme déduite d'une URL collée, pour ajuster le sélecteur automatiquement. */
function providerFromReference(reference: string, gitlabHosts: string[]): ProviderId | null {
  const value = reference.trim().toLowerCase();
  if (/(^|[/@.])github\.com[/:]/.test(value)) return "github";
  if (/(^|[/@.])bitbucket\.org[/:]/.test(value)) return "bitbucket";
  if (/(^|[/@.])gitlab\.com[/:]/.test(value)) return "gitlab";
  if (gitlabHosts.some((host) => host && value.includes(host))) return "gitlab";
  return null;
}

/** Chemin « propriétaire/dépôt » approximatif, uniquement pour prévenir d'un doublon. */
function guessPath(reference: string) {
  return reference
    .trim()
    .replace(/^(https?:\/\/[^/]+\/|git@[^:]+:)/, "")
    .replace(/\/-\/.*$/, "")
    .replace(/(\.git)?\/?$/, "");
}

export function AddRepositoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: session } = useSession();
  const { add } = useRepositoryActions();
  const { byKey } = useScans();
  const navigate = useNavigate();
  const connected = (session?.accounts ?? []).map((account) => account.provider);
  const [provider, setProvider] = useState<ProviderId>(connected[0] ?? "github");
  const [reference, setReference] = useState("");

  const gitlabHosts = (session?.accounts ?? []).filter((a) => a.provider === "gitlab").map((a) => a.host.replace(/^https?:\/\//, "").toLowerCase());
  const detected = providerFromReference(reference, gitlabHosts);
  const effectiveProvider = detected ?? provider;
  const notConnected = !connected.includes(effectiveProvider);

  useEffect(() => {
    if (!open) {
      setReference("");
      add.reset();
    } else if (connected.length && !connected.includes(provider)) {
      setProvider(connected[0]);
    }
  }, [open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!reference.trim()) return;
    add.mutate(
      { reference, provider: effectiveProvider },
      {
        onSuccess: ({ repository }) => {
          onOpenChange(false);
          navigate(repoPath(repository.provider, repository.full_name));
        },
      },
    );
  };

  const alreadyListed = Boolean(reference.trim()) && byKey.has(repoKey(effectiveProvider, guessPath(reference)));

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Ajouter un dépôt"
      description="Suivez un dépôt qui n'apparaît pas automatiquement : un projet open source, ou un dépôt d'une organisation dont vous n'êtes pas membre."
    >
      <form onSubmit={submit} className="space-y-4 px-5 py-4">
        {connected.length > 1 ? (
          <SegmentedControl<ProviderId>
            value={effectiveProvider}
            onChange={(next) => {
              setProvider(next);
              add.reset();
            }}
            options={connected.map((id) => ({
              value: id,
              label: (
                <>
                  <ProviderIcon provider={id} />
                  {PROVIDER_LABELS[id].label}
                </>
              ),
            }))}
          />
        ) : null}

        <div>
          <label htmlFor="repo-reference" className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-fg-muted">
            <ProviderIcon provider={effectiveProvider} className="size-3.5" />
            Dépôt {PROVIDER_LABELS[effectiveProvider].label}
            {detected && connected.length > 1 ? <span className="font-normal text-fg-subtle">· reconnu depuis l'URL</span> : null}
          </label>
          <Input
            id="repo-reference"
            autoFocus
            icon={<FolderGit2 />}
            placeholder={PLACEHOLDERS[effectiveProvider]}
            value={reference}
            onChange={(event) => {
              setReference(event.target.value);
              add.reset();
            }}
            className={cn("h-10", add.error && "border-failure/50")}
            spellCheck={false}
            autoComplete="off"
          />
          {add.error ? (
            <p className="mt-1.5 text-[12.5px] text-failure animate-fade-in">{add.error.message}</p>
          ) : notConnected ? (
            <p className="mt-1.5 text-[12.5px] text-running">
              Aucun compte {PROVIDER_LABELS[effectiveProvider].label} connecté : connectez-le d'abord dans Paramètres › Comptes.
            </p>
          ) : alreadyListed ? (
            <p className="mt-1.5 text-[12.5px] text-fg-muted">Ce dépôt est déjà dans votre liste.</p>
          ) : (
            <p className="mt-1.5 text-[12px] text-fg-subtle">
              Exemples :{" "}
              {EXAMPLES[effectiveProvider].map((example, index) => (
                <button key={example} type="button" onClick={() => setReference(example)} className="font-mono text-fg-muted hover:text-accent">
                  {example}
                  {index < EXAMPLES[effectiveProvider].length - 1 ? ", " : ""}
                </button>
              ))}
            </p>
          )}
        </div>

        <div className="flex gap-2.5 rounded-xl bg-surface-2/70 p-3 text-[12.5px] leading-relaxed text-fg-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" />
          <p>
            {session?.mode === "demo"
              ? "En mode démo, seuls les dépôts fictifs sont disponibles. Connectez vos comptes pour suivre vos vrais dépôts."
              : "Les dépôts auxquels vos comptes donnent accès sont déjà ajoutés automatiquement. Pour un dépôt privé, vos identifiants doivent y avoir accès."}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" loading={add.isPending} disabled={!reference.trim() || alreadyListed || notConnected}>
            Ajouter le dépôt
          </Button>
        </div>
      </form>
    </Modal>
  );
}
