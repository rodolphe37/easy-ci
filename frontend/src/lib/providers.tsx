import { useParams } from "react-router";
import i18n from "@/i18n";
import type { ProviderId } from "./types";
import { cn } from "./utils";

export const PROVIDER_IDS: ProviderId[] = ["github", "gitlab", "bitbucket"];

/** Libellés disponibles hors session (écran de connexion, liens) ; la session fournit les capacités. */
export const PROVIDER_LABELS: Record<ProviderId, { label: string; ci: string; config: string; workflows: string; run: string }> = {
  github: { label: "GitHub", ci: "GitHub Actions", config: ".github/workflows", workflows: "Workflows", get run() { return i18n.t("nav.run"); } },
  gitlab: { label: "GitLab", ci: "GitLab CI/CD", config: ".gitlab-ci.yml", workflows: "Pipelines", run: "Pipeline" },
  bitbucket: { label: "Bitbucket", ci: "Bitbucket Pipelines", config: "bitbucket-pipelines.yml", workflows: "Pipelines", run: "Pipeline" },
};

export function repoPath(provider: ProviderId, fullName: string, suffix = "") {
  return `/repos/${provider}/${encodeURIComponent(fullName)}${suffix}`;
}

export function runPath(provider: ProviderId, fullName: string, runId: string) {
  return repoPath(provider, fullName, `/runs/${encodeURIComponent(runId)}`);
}

export function repoKey(provider: ProviderId, fullName: string) {
  return `${provider}:${fullName}`;
}

/** Dépôt désigné par l'URL courante (/repos/:provider/:repo). */
export function useRepoRef() {
  const { provider, repo } = useParams();
  return { provider: (provider ?? "github") as ProviderId, full_name: repo ?? "" };
}

export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4", className)} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden>
      <path d="M12 21.4 15.9 9.3H8.1L12 21.4Z" fill="#E24329" />
      <path d="M12 21.4 8.1 9.3H2.6L12 21.4Z" fill="#FC6D26" />
      <path d="M2.6 9.3 1.4 12.9c-.1.3 0 .7.3.9L12 21.4 2.6 9.3Z" fill="#FCA326" />
      <path d="M2.6 9.3h5.5L5.7 2c-.1-.4-.7-.4-.8 0L2.6 9.3Z" fill="#E24329" />
      <path d="M12 21.4 15.9 9.3h5.5L12 21.4Z" fill="#FC6D26" />
      <path d="m21.4 9.3 1.2 3.6c.1.3 0 .7-.3.9L12 21.4l9.4-12.1Z" fill="#FCA326" />
      <path d="M21.4 9.3h-5.5L18.3 2c.1-.4.7-.4.8 0l2.3 7.3Z" fill="#E24329" />
    </svg>
  );
}

export function BitbucketIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden>
      <defs>
        <linearGradient id="bitbucket-gradient" x1="22" y1="11" x2="12" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0.18" stopColor="#0052CC" />
          <stop offset="1" stopColor="#2684FF" />
        </linearGradient>
      </defs>
      <path d="M2.65 3a.61.61 0 0 0-.61.71l2.6 15.8a.83.83 0 0 0 .81.69h12.47a.61.61 0 0 0 .61-.51l2.6-15.98a.61.61 0 0 0-.61-.71H2.65Z" fill="#2684FF" />
      <path d="M21.13 9.44h-6.66l-1.12 6.52h-4.6l-5.43 6.45c.17.15.4.24.63.24h12.47a.61.61 0 0 0 .61-.51l2.1-12.7Z" fill="url(#bitbucket-gradient)" opacity="0.9" />
      <path d="M9.5 9.44h5l-.85 4.99H10.4L9.5 9.44Z" fill="white" />
    </svg>
  );
}

export function ProviderIcon({ provider, className, mono }: { provider: ProviderId; className?: string; mono?: boolean }) {
  if (provider === "gitlab") return <GitLabIcon className={cn(mono && "grayscale", className)} />;
  if (provider === "bitbucket") return <BitbucketIcon className={cn(mono && "grayscale", className)} />;
  return <GitHubIcon className={className} />;
}
