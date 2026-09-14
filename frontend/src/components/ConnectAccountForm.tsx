import { AtSign, Eye, EyeOff, Globe, KeyRound, Terminal } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useSession, useSessionActions } from "@/hooks/session";
import { api } from "@/lib/api";
import { PROVIDER_IDS, PROVIDER_LABELS, ProviderIcon } from "@/lib/providers";
import type { ProviderId, Session } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, Input, SegmentedControl } from "./ui/primitives";

const GITLAB_DEFAULT_HOST = "https://gitlab.com";

function gitlabTokenUrl(host: string) {
  const base = (host.trim() || GITLAB_DEFAULT_HOST).replace(/\/+$/, "");
  const withScheme = /^https?:\/\//.test(base) ? base : `https://${base}`;
  return `${withScheme}/-/user_settings/personal_access_tokens?name=Easy%20CI&scopes=api,read_user`;
}

/**
 * Formulaire de connexion d'un compte GitHub, GitLab ou Bitbucket.
 * Utilisé sur l'écran d'accueil et dans Paramètres › Comptes.
 */
export function ConnectAccountForm({
  initialProvider = "github",
  lockProvider = false,
  onConnected,
  onOpenGuide,
}: {
  initialProvider?: ProviderId;
  /** Masque le choix de la plateforme (reconnexion d'un compte précis). */
  lockProvider?: boolean;
  onConnected?: (session: Session) => void;
  onOpenGuide?: (provider: ProviderId) => void;
}) {
  const { data: session } = useSession();
  const { connect, loginWithGhCli } = useSessionActions();
  const [provider, setProvider] = useState<ProviderId>(initialProvider);
  const [token, setToken] = useState("");
  const [host, setHost] = useState(GITLAB_DEFAULT_HOST);
  const [email, setEmail] = useState("");
  const [bitbucketMode, setBitbucketMode] = useState<"api_token" | "access_token">("api_token");
  const [visible, setVisible] = useState(false);

  const error = connect.error ?? loginWithGhCli.error;
  const busy = connect.isPending || loginWithGhCli.isPending;
  const label = PROVIDER_LABELS[provider].label;

  const reset = (next: ProviderId) => {
    setProvider(next);
    setToken("");
    setVisible(false);
    connect.reset();
    loginWithGhCli.reset();
  };

  const credentials = (): Record<string, string> | null => {
    if (!token.trim()) return null;
    if (provider === "gitlab") return { token, host: host.trim() || GITLAB_DEFAULT_HOST };
    if (provider === "bitbucket") {
      if (bitbucketMode === "access_token") return { access_token: token };
      return email.trim() ? { email, api_token: token } : null;
    }
    return { token };
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const values = credentials();
    if (values) connect.mutate({ provider, credentials: values }, { onSuccess: (s) => onConnected?.(s) });
  };

  const tokenUrl =
    provider === "gitlab" ? gitlabTokenUrl(host) : (session?.providers[provider]?.token_url ?? "https://github.com/settings/tokens");
  const tokenPlaceholder =
    provider === "github" ? "ghp_… ou github_pat_…" : provider === "gitlab" ? "glpat-…" : bitbucketMode === "access_token" ? "ATCTT…" : "ATATT…";
  const scopesHint =
    provider === "github" ? "repo, workflow, read:org" : provider === "gitlab" ? "api, read_user" : "lecture des dépôts et pipelines, écriture des pipelines";

  const secretToggle = (
    <button type="button" onClick={() => setVisible((v) => !v)} className="text-fg-subtle hover:text-fg" aria-label={visible ? "Masquer" : "Afficher"}>
      {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );

  return (
    <div>
      {lockProvider ? null : (
        <SegmentedControl<ProviderId>
          value={provider}
          onChange={reset}
          className="mb-5 grid w-full grid-cols-3 [&>button]:h-8 [&>button]:justify-center"
          options={PROVIDER_IDS.map((id) => ({
            value: id,
            label: (
              <>
                <ProviderIcon provider={id} />
                {PROVIDER_LABELS[id].label}
              </>
            ),
          }))}
        />
      )}

      <form onSubmit={submit} className="space-y-3">
        {provider === "gitlab" ? (
          <Field label="Adresse de l'instance" htmlFor="gitlab-host" hint="gitlab.com ou l'adresse de votre GitLab auto-hébergé.">
            <Input id="gitlab-host" icon={<Globe />} value={host} onChange={(e) => setHost(e.target.value)} placeholder={GITLAB_DEFAULT_HOST} className="h-10" spellCheck={false} />
          </Field>
        ) : null}

        {provider === "bitbucket" ? (
          <>
            <SegmentedControl<"api_token" | "access_token">
              value={bitbucketMode}
              onChange={(mode) => {
                setBitbucketMode(mode);
                setToken("");
                connect.reset();
              }}
              options={[
                { value: "api_token", label: "API token personnel" },
                { value: "access_token", label: "Access token (workspace / dépôt)" },
              ]}
            />
            {bitbucketMode === "api_token" ? (
              <Field label="E-mail du compte Atlassian" htmlFor="bitbucket-email">
                <Input
                  id="bitbucket-email"
                  type="email"
                  icon={<AtSign />}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@exemple.fr"
                  className="h-10"
                  autoComplete="off"
                />
              </Field>
            ) : null}
          </>
        ) : null}

        <Field
          label={provider === "bitbucket" ? (bitbucketMode === "access_token" ? "Access token" : "API token") : "Personal access token"}
          htmlFor={`${provider}-token`}
        >
          <Input
            id={`${provider}-token`}
            autoFocus={provider !== "gitlab"}
            type={visible ? "text" : "password"}
            placeholder={tokenPlaceholder}
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              connect.reset();
            }}
            icon={<KeyRound />}
            className={cn("h-10", error && "border-failure/50")}
            spellCheck={false}
            autoComplete="off"
            trailing={secretToggle}
          />
        </Field>

        {error ? <p className="text-[12.5px] text-failure animate-fade-in">{error.message}</p> : null}

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={connect.isPending} disabled={!credentials() || busy}>
          <ProviderIcon provider={provider} className={cn(provider === "github" && "text-current")} />
          Se connecter à {label}
        </Button>
      </form>

      <p className="mt-3 text-[12.5px] leading-relaxed text-fg-subtle">
        Pas encore de token ?{" "}
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => void api.openExternal(tokenUrl)}>
          En créer un sur {label}
        </button>{" "}
        <span>({scopesHint})</span>
        {onOpenGuide ? (
          <>
            {" · "}
            <button type="button" className="font-medium text-fg-muted hover:text-accent" onClick={() => onOpenGuide(provider)}>
              Guide pas à pas
            </button>
          </>
        ) : null}
      </p>

      {provider === "github" && session?.gh_cli_available ? (
        <Button size="lg" className="mt-4 w-full" onClick={() => loginWithGhCli.mutate(undefined, { onSuccess: (s) => onConnected?.(s) })} loading={loginWithGhCli.isPending} disabled={busy}>
          <Terminal />
          Utiliser la session GitHub CLI
        </Button>
      ) : null}
    </div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12.5px] font-medium text-fg-muted" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[11.5px] text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
