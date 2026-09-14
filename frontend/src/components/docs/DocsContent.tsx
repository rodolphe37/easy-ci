import {
  Activity,
  BookOpen,
  CircleHelp,
  ExternalLink,
  FolderGit2,
  Gauge,
  GitBranch,
  KeyRound,
  Keyboard,
  Laptop,
  LayoutDashboard,
  Lightbulb,
  RotateCcw,
  ScrollText,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { CI_STATE_INFO, CiStateBadge } from "@/components/local/LocalProjectPanel";
import { STATE_LABELS, StatusIcon } from "@/components/status";
import { Kbd } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import type { CiFileState, ProviderId, RunStateName } from "@/lib/types";
import { cn } from "@/lib/utils";

const CLASSIC_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,workflow,read:org&description=Easy%20CI";
const FINE_GRAINED_URL = "https://github.com/settings/personal-access-tokens/new";

/* -------------------------------------------------------------------------- */
/* Éléments de mise en page                                                   */
/* -------------------------------------------------------------------------- */

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 mb-2 text-[14.5px] font-semibold text-fg">{children}</h3>;
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("my-2.5 text-[13.5px] leading-[1.7] text-fg-muted", className)}>{children}</p>;
}

function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-fg">{children}</strong>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg ring-1 ring-line ring-inset">{children}</code>;
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative my-3">
      <pre className="scrollbar-thin overflow-x-auto rounded-xl border border-line bg-log px-4 py-3 font-mono text-[12.5px] text-fg">{children}</pre>
      <button
        onClick={() => void navigator.clipboard.writeText(children).then(() => setCopied(true))}
        onMouseLeave={() => setCopied(false)}
        className="absolute top-2 right-2 rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"
      >
        {copied ? "Copié" : "Copier"}
      </button>
    </div>
  );
}

function ExternalButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <button onClick={() => void api.openExternal(href)} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
      {children}
      <ExternalLink className="size-3" />
    </button>
  );
}

export function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol className="my-4 space-y-0">
      {children.map((child, index) => (
        <li key={index} className="relative flex gap-3.5 pb-4 last:pb-0">
          {index < children.length - 1 ? <span className="absolute top-7 bottom-0 left-[11.5px] w-px bg-line" aria-hidden /> : null}
          <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent ring-1 ring-accent/20">
            {index + 1}
          </span>
          <div className="min-w-0 pt-0.5 text-[13.5px] leading-[1.7] text-fg-muted">{child}</div>
        </li>
      ))}
    </ol>
  );
}

const CALLOUTS = {
  info: { icon: CircleHelp, className: "border-accent/20 bg-accent-soft/60", iconClass: "text-accent" },
  tip: { icon: Lightbulb, className: "border-success/20 bg-success/[0.06]", iconClass: "text-success" },
  warning: { icon: TriangleAlert, className: "border-running/25 bg-running/[0.07]", iconClass: "text-running" },
  security: { icon: ShieldCheck, className: "border-line bg-surface-2/70", iconClass: "text-fg-muted" },
};

export function Callout({ variant = "info", title, children }: { variant?: keyof typeof CALLOUTS; title?: string; children: ReactNode }) {
  const { icon: Icon, className, iconClass } = CALLOUTS[variant];
  return (
    <div className={cn("my-4 flex gap-3 rounded-xl border p-3.5", className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} />
      <div className="min-w-0 text-[13px] leading-relaxed text-fg-muted">
        {title ? <div className="mb-0.5 font-semibold text-fg">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="scrollbar-thin my-4 overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="bg-surface-2/70">
            {head.map((cell) => (
              <th key={cell} className="px-3.5 py-2 text-[12px] font-semibold text-fg-muted">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, index) => (
            <tr key={index} className="align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={cn("px-3.5 py-2.5 leading-relaxed", cellIndex === 0 ? "text-fg" : "text-fg-muted")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Question({ question, children }: { question: string; children: ReactNode }) {
  return (
    <details className="group my-2 rounded-xl border border-line bg-surface open:shadow-soft">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[13.5px] font-medium text-fg select-none [&::-webkit-details-marker]:hidden">
        <CircleHelp className="size-4 shrink-0 text-fg-subtle" />
        <span className="flex-1">{question}</span>
        <span className="text-fg-subtle transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="border-t border-line px-4 pt-1 pb-3">{children}</div>
    </details>
  );
}

/* -------------------------------------------------------------------------- */
/* Contenu                                                                    */
/* -------------------------------------------------------------------------- */

export interface DocSection {
  id: string;
  title: string;
  icon: LucideIcon;
  summary: string;
  content: ReactNode;
}

export function GitHubGuide() {
  return (
    <>
      <P>
        Easy CI lit vos dépôts et vos pipelines avec l'API officielle de GitHub. Pour cela, l'application a besoin d'un <Strong>token d'accès personnel</Strong> :
        une clé que vous créez sur GitHub, que vous pouvez limiter et révoquer à tout moment. Trois méthodes sont possibles.
      </P>

      <H3>Méthode 1 : token classique (recommandée)</H3>
      <P>C'est la plus simple : un seul token donne accès à vos dépôts personnels et à ceux de toutes vos organisations.</P>
      <Steps>
        <>
          Sur l'écran de connexion d'Easy CI, onglet <Strong>GitHub</Strong>, cliquez sur <Strong>« En créer un sur GitHub »</Strong>, ou ouvrez directement{" "}
          <ExternalButton href={CLASSIC_TOKEN_URL}>la page de création de token</ExternalButton>. Les droits nécessaires sont déjà cochés.
          <div className="mt-1 text-[12.5px] text-fg-subtle">
            Chemin manuel : avatar GitHub › Settings › Developer settings › Personal access tokens › Tokens (classic) › Generate new token (classic).
          </div>
        </>
        <>
          Donnez-lui un nom reconnaissable (<Code>Easy CI</Code>) et choisissez une <Strong>date d'expiration</Strong> (90 jours est un bon compromis).
        </>
        <>
          Vérifiez les droits (<i>scopes</i>) cochés :
          <Table
            head={["Droit", "À quoi il sert dans Easy CI"]}
            rows={[
              [<Code>repo</Code>, "Lire vos dépôts privés, leurs workflows, exécutions et logs ; relancer et annuler des exécutions."],
              [<Code>workflow</Code>, "Modifier les fichiers de workflow (édition et génération de pipelines, prochaines versions)."],
              [<Code>read:org</Code>, "Lister les dépôts des organisations dont vous êtes membre."],
            ]}
          />
        </>
        <>
          Cliquez sur <Strong>Generate token</Strong> puis copiez la valeur (elle commence par <Code>ghp_</Code>). GitHub ne l'affiche qu'une seule fois.
        </>
        <>
          Revenez dans Easy CI, collez le token dans le champ <Strong>Personal access token</Strong> et cliquez sur <Strong>Se connecter à GitHub</Strong>.
          Vos dépôts apparaissent en quelques secondes.
        </>
      </Steps>

      <Callout variant="warning" title="Organisation avec authentification unique (SSO)">
        Si votre entreprise utilise le SSO SAML, le token doit être autorisé pour l'organisation : sur{" "}
        <ExternalButton href="https://github.com/settings/tokens">la liste de vos tokens</ExternalButton>, cliquez sur <Strong>Configure SSO</Strong> à côté du
        token, puis sur <Strong>Authorize</Strong>. Sans cette étape, les dépôts de l'organisation n'apparaissent pas.
      </Callout>

      <H3>Méthode 2 : token à accès limité (fine-grained)</H3>
      <P>
        Plus restrictif : vous choisissez précisément les dépôts et les permissions. En contrepartie, un token ne couvre qu'un seul propriétaire (votre compte{" "}
        <i>ou</i> une organisation).
      </P>
      <Steps>
        <>
          Ouvrez <ExternalButton href={FINE_GRAINED_URL}>la création de token fine-grained</ExternalButton> (Settings › Developer settings › Personal access tokens ›
          Fine-grained tokens).
        </>
        <>
          Choisissez le <Strong>Resource owner</Strong> (vous ou l'organisation), puis <Strong>All repositories</Strong> ou <Strong>Only select repositories</Strong>.
        </>
        <>
          Dans <Strong>Repository permissions</Strong>, accordez :
          <Table
            head={["Permission", "Niveau", "Utilité"]}
            rows={[
              ["Metadata", "Read-only", "Obligatoire : lister les dépôts."],
              ["Actions", "Read and write", "Voir les exécutions et les logs, relancer, annuler. « Read-only » suffit pour consulter."],
              ["Contents", "Read-only", "Lire les fichiers de workflow YAML."],
              ["Checks", "Read-only", "Afficher les annotations d'erreur (fichier et ligne en cause)."],
            ]}
          />
        </>
        <>Générez le token (il commence par <Code>github_pat_</Code>), copiez-le et collez-le dans Easy CI.</>
      </Steps>
      <Callout variant="info">Certaines organisations exigent qu'un administrateur approuve les tokens fine-grained avant qu'ils ne fonctionnent.</Callout>

      <H3>Méthode 3 : réutiliser GitHub CLI</H3>
      <P>
        Si l'outil en ligne de commande <Code>gh</Code> est installé et connecté, le bouton <Strong>« Utiliser la session GitHub CLI »</Strong> apparaît sur l'écran de
        connexion : aucun token à copier.
      </P>
      <CodeBlock>gh auth login</CodeBlock>
      <P>Pour pouvoir modifier des workflows plus tard, ajoutez le droit correspondant :</P>
      <CodeBlock>gh auth refresh -s workflow</CodeBlock>

      <Callout variant="security" title="Où est stocké mon token ?">
        Dans le trousseau sécurisé de votre système (Trousseau d'accès macOS, Gestionnaire d'identification Windows, Secret Service sous Linux). Il n'est envoyé
        qu'à <Code>api.github.com</Code>, jamais à un serveur Easy CI. Vous pouvez aussi le fournir via la variable d'environnement <Code>EASY_CI_GITHUB_TOKEN</Code>.
      </Callout>
    </>
  );
}

export function GitLabGuide() {
  return (
    <>
      <P>
        Easy CI fonctionne avec <Strong>gitlab.com</Strong> et avec les <Strong>instances GitLab auto-hébergées</Strong> (version 15 ou plus récente). La connexion
        utilise un <Strong>personal access token</Strong>.
      </P>
      <Steps>
        <>
          Dans Easy CI, choisissez l'onglet <Strong>GitLab</Strong>. Pour une instance d'entreprise, remplacez <Code>https://gitlab.com</Code> par son adresse (par
          exemple <Code>gitlab.monentreprise.fr</Code>).
        </>
        <>
          Cliquez sur <Strong>« En créer un sur GitLab »</Strong> : la page de création s'ouvre sur la bonne instance avec le nom et les droits pré-remplis.
          <div className="mt-1 text-[12.5px] text-fg-subtle">Chemin manuel : avatar › Preferences (ou Edit profile) › Access tokens › Add new token.</div>
        </>
        <>
          Choisissez une date d'expiration et vérifiez les droits (<i>scopes</i>) :
          <Table
            head={["Droit", "À quoi il sert dans Easy CI"]}
            rows={[
              [<Code>api</Code>, "Lire projets, pipelines, jobs et logs ; relancer et annuler des pipelines. Nécessaire à l'édition des fichiers CI (prochaine version)."],
              [<Code>read_api</Code>, "Alternative en lecture seule : tout est visible, mais relancer et annuler sont refusés."],
              [<Code>read_user</Code>, "Afficher votre nom et votre avatar."],
            ]}
          />
        </>
        <>
          Cliquez sur <Strong>Create personal access token</Strong>, copiez la valeur (elle commence par <Code>glpat-</Code>) puis collez-la dans Easy CI.
        </>
      </Steps>
      <Callout variant="info" title="Quels projets apparaissent ?">
        Tous les projets dont vous êtes <Strong>membre</Strong>, directement ou via un groupe (sous-groupes compris). Le chemin complet est conservé :{" "}
        <Code>groupe/sous-groupe/projet</Code>.
      </Callout>
      <Callout variant="warning" title="Instance auto-hébergée avec certificat interne">
        Si votre GitLab utilise un certificat émis par une autorité interne, ajoutez-la au magasin de certificats du système ; sinon la connexion échouera avec
        une erreur réseau.
      </Callout>
      <P>
        Variables d'environnement équivalentes : <Code>EASY_CI_GITLAB_TOKEN</Code> et <Code>EASY_CI_GITLAB_URL</Code>.
      </P>
    </>
  );
}

export function BitbucketGuide() {
  return (
    <>
      <P>
        Easy CI prend en charge <Strong>Bitbucket Cloud</Strong> (bitbucket.org). Atlassian a remplacé les « app passwords » par des <Strong>API tokens</Strong>{" "}
        : c'est la méthode recommandée.
      </P>

      <H3>Méthode 1 : API token personnel (recommandée)</H3>
      <Steps>
        <>
          Ouvrez <ExternalButton href="https://id.atlassian.com/manage-profile/security/api-tokens">la gestion des API tokens Atlassian</ExternalButton> (le lien «
          En créer un sur Bitbucket » d'Easy CI y mène aussi).
        </>
        <>
          Cliquez sur <Strong>Create API token with scopes</Strong>, nommez-le <Code>Easy CI</Code>, choisissez une expiration, puis l'application{" "}
          <Strong>Bitbucket</Strong>.
        </>
        <>
          Cochez les droits suivants :
          <Table
            head={["Droit", "Utilité"]}
            rows={[
              [<Code>read:user:bitbucket</Code>, "Afficher votre nom et votre avatar."],
              [<Code>read:workspace:bitbucket</Code>, "Parcourir vos workspaces."],
              [<Code>read:repository:bitbucket</Code>, "Lister les dépôts et lire bitbucket-pipelines.yml."],
              [<Code>read:pipeline:bitbucket</Code>, "Voir les pipelines, les steps et les logs."],
              [<Code>write:pipeline:bitbucket</Code>, "Relancer et arrêter des pipelines (facultatif)."],
            ]}
          />
        </>
        <>
          Copiez le token. Dans Easy CI, onglet <Strong>Bitbucket</Strong> › <Strong>API token personnel</Strong> : saisissez l'<Strong>e-mail de votre compte
          Atlassian</Strong> (et non votre nom d'utilisateur) et collez le token.
        </>
      </Steps>

      <H3>Méthode 2 : access token de workspace ou de dépôt</H3>
      <P>
        Pratique pour un compte technique : dans Bitbucket, <Strong>Workspace settings</Strong> (ou <Strong>Repository settings</Strong>) › <Strong>Access
        tokens</Strong> › Create access token, avec les droits <i>Repositories : Read</i> et <i>Pipelines : Read</i> (ou <i>Write</i> pour relancer). Dans Easy CI,
        choisissez <Strong>Access token</Strong> et collez-le.
      </P>
      <Callout variant="info">
        Un access token n'est lié à aucun utilisateur : si vos dépôts n'apparaissent pas automatiquement, ajoutez-les avec <Strong>Ajouter un dépôt</Strong>{" "}
        (<Code>workspace/dépôt</Code>).
      </Callout>

      <H3>Particularités de Bitbucket Pipelines</H3>
      <ul className="my-3 ml-5 list-disc space-y-1 text-[13.5px] leading-relaxed text-fg-muted marker:text-fg-subtle">
        <li>Chaque « step » du pipeline apparaît comme un job ; ses commandes (lignes <Code>+ …</Code>) forment les sections du log.</li>
        <li>
          <Strong>Relancer</Strong> crée un nouveau pipeline sur la même branche : Bitbucket ne permet pas de rejouer uniquement les steps en échec via son API.
        </li>
        <li>Bitbucket ne fournit pas d'annotations : Easy CI extrait l'erreur des dernières lignes du log.</li>
      </ul>
      <P>
        Variables d'environnement : <Code>EASY_CI_BITBUCKET_EMAIL</Code> + <Code>EASY_CI_BITBUCKET_API_TOKEN</Code>, ou <Code>EASY_CI_BITBUCKET_ACCESS_TOKEN</Code>.
      </P>
    </>
  );
}

export function ProviderGuide({ provider }: { provider: ProviderId }) {
  if (provider === "gitlab") return <GitLabGuide />;
  if (provider === "bitbucket") return <BitbucketGuide />;
  return <GitHubGuide />;
}

function AccountsGuide() {
  return (
    <>
      <P>
        Easy CI peut suivre <Strong>GitHub, GitLab et Bitbucket en même temps</Strong>, avec un compte par plateforme. Tous les dépôts apparaissent dans les mêmes
        listes, identifiés par le logo de leur plateforme.
      </P>
      <Steps>
        <>
          Au premier lancement, connectez la plateforme de votre choix depuis l'écran d'accueil (les détails pour chacune sont dans les sections suivantes).
        </>
        <>
          Pour en ajouter une autre : <Strong>Paramètres › Comptes</Strong> › bouton <Strong>Connecter</Strong> sur la ligne de la plateforme.
        </>
        <>
          Pour retirer un compte : <Strong>Déconnecter</Strong> sur sa ligne. Ses identifiants sont supprimés du trousseau ; les autres comptes restent actifs.
        </>
      </Steps>
      <Callout variant="info" title="Identifiants expirés">
        Si une plateforme refuse vos identifiants (token expiré ou révoqué), seul ce compte est déconnecté et un message l'indique dans Paramètres › Comptes. Les
        autres plateformes continuent de fonctionner.
      </Callout>
      <H3>Sans compte : le mode démo</H3>
      <P>
        <Strong>« Explorer en mode démo »</Strong> charge des dépôts fictifs sur les trois plateformes, dont certains pipelines s'exécutent en temps réel. Pour passer à
        vos vrais comptes, cliquez sur <Strong>Connecter un compte</Strong> en haut de l'écran.
      </P>
      <Table
        head={["", "GitHub Actions", "GitLab CI/CD", "Bitbucket Pipelines"]}
        rows={[
          ["Fichier de configuration", <Code>.github/workflows/*.yml</Code>, <Code>.gitlab-ci.yml</Code>, <Code>bitbucket-pipelines.yml</Code>],
          ["Logs pendant l'exécution", "Étapes en direct, log à la fin du job", "Log en direct", "Log en direct"],
          ["Relancer les jobs en échec", "Oui", "Oui", "Non (nouveau pipeline)"],
          ["Annotations d'erreur", "Oui", "Rapports de tests JUnit", "Non (extrait du log)"],
          ["Instances auto-hébergées", "Non", "Oui", "Non (Cloud uniquement)"],
        ]}
      />
    </>
  );
}

const STATES: RunStateName[] = ["success", "failure", "running", "queued", "cancelled", "skipped", "action_required", "none"];
const STATE_HELP: Record<string, string> = {
  success: "Tous les jobs se sont terminés sans erreur.",
  failure: "Au moins un job a échoué ou a dépassé son délai maximal.",
  running: "L'exécution est en cours ; les étapes se mettent à jour en direct.",
  queued: "En attente d'un runner disponible ou d'un job dont elle dépend.",
  cancelled: "Arrêtée manuellement ou remplacée par une exécution plus récente.",
  skipped: "Non exécuté, souvent parce qu'un job précédent a échoué.",
  action_required: "Une approbation est nécessaire sur GitHub (environnement protégé, contributeur externe…).",
  none: "Le dépôt ne contient aucun workflow GitHub Actions.",
};

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "start",
    title: "Bien démarrer",
    icon: BookOpen,
    summary: "Ce que fait Easy CI et comment l'utiliser en trois étapes.",
    content: (
      <>
        <P>
          Easy CI réunit dans une seule application les pipelines CI/CD de tous vos dépôts. Plus besoin d'ouvrir chaque dépôt sur GitHub : vous voyez d'un coup
          d'œil ce qui passe, ce qui tourne et ce qui casse, et vous comprenez pourquoi.
        </P>
        <Steps>
          <>
            <Strong>Connectez GitHub, GitLab ou Bitbucket</Strong> avec un token (voir les sections suivantes), ou explorez d'abord le mode démo.
          </>
          <>
            <Strong>Vos dépôts sont détectés automatiquement</Strong> avec leurs pipelines. Ajoutez ou masquez des dépôts si besoin.
          </>
          <>
            <Strong>Suivez et agissez</Strong> : exécutions en direct, résumé des erreurs, logs lisibles, relance ou annulation en un clic.
          </>
        </Steps>
        <Callout variant="tip" title="Astuce">
          Appuyez sur <Kbd>⌘</Kbd> <Kbd>K</Kbd> (ou <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>) n'importe où pour rechercher un dépôt ou lancer une action.
        </Callout>
      </>
    ),
  },
  { id: "accounts", title: "Comptes et plateformes", icon: Users, summary: "Connecter plusieurs plateformes, mode démo, comparatif.", content: <AccountsGuide /> },
  { id: "connect", title: "Connecter GitHub", icon: GitBranch, summary: "Créer un token, les droits nécessaires, SSO, GitHub CLI.", content: <GitHubGuide /> },
  { id: "gitlab", title: "Connecter GitLab", icon: KeyRound, summary: "gitlab.com ou auto-hébergé, token et droits.", content: <GitLabGuide /> },
  { id: "bitbucket", title: "Connecter Bitbucket", icon: KeyRound, summary: "API token Atlassian ou access token.", content: <BitbucketGuide /> },
  {
    id: "repositories",
    title: "Ajouter et gérer les dépôts",
    icon: FolderGit2,
    summary: "Découverte automatique, ajout manuel, masquage et favoris.",
    content: (
      <>
        <H3>Découverte automatique</H3>
        <P>Dès la connexion d'un compte, Easy CI récupère tous les dépôts accessibles, sans configuration :</P>
        <Table
          head={["Plateforme", "Dépôts découverts"]}
          rows={[
            ["GitHub", <>Vos dépôts, ceux où vous êtes collaborateur, ceux de vos organisations (droit <Code>read:org</Code>).</>],
            ["GitLab", "Les projets dont vous êtes membre, directement ou via un groupe ou sous-groupe."],
            ["Bitbucket", "Les dépôts des workspaces dont vous êtes membre."],
          ]}
        />
        <P>
          Chaque dépôt est ensuite analysé : Easy CI cherche sa configuration CI (<Code>.github/workflows/*.yml</Code>, <Code>.gitlab-ci.yml</Code> ou{" "}
          <Code>bitbucket-pipelines.yml</Code>) et récupère le statut des derniers pipelines. Les dépôts sans CI restent visibles, en fin de liste, avec la mention
          « Aucun pipeline détecté ». Avec plusieurs comptes, un filtre par plateforme apparaît au-dessus de la liste.
        </P>
        <Callout variant="info">
          Les 1 000 dépôts les plus récemment modifiés sont pris en compte. Les dépôts archivés sont masqués par défaut (Paramètres › Synchronisation).
        </Callout>

        <H3>Ajouter un dépôt manuellement</H3>
        <P>Utile pour suivre un projet open source, ou un dépôt d'une organisation dont vous n'êtes pas membre.</P>
        <Steps>
          <>
            Page <Strong>Dépôts</Strong> › bouton <Strong>Ajouter un dépôt</Strong> (ou Paramètres › Dépôts suivis).
          </>
          <>
            Choisissez la plateforme, puis saisissez <Code>propriétaire/dépôt</Code> (GitLab : <Code>groupe/sous-groupe/projet</Code>) ou collez directement l'URL
            du dépôt : la plateforme est alors reconnue automatiquement (<Code>https://gitlab.com/…</Code>, <Code>git@bitbucket.org:…</Code>).
          </>
          <>Easy CI vérifie que le dépôt existe et que vos identifiants y ont accès, puis l'ajoute et ouvre sa page.</>
        </Steps>
        <P>Les dépôts ajoutés portent le badge « Ajouté ». Pour ne plus les suivre : menu <Strong>⋯</Strong> de la ligne › <Strong>Ne plus suivre</Strong>.</P>

        <H3>Masquer un dépôt</H3>
        <P>
          Un dépôt découvert automatiquement vous encombre ? Menu <Strong>⋯</Strong> › <Strong>Masquer ce dépôt</Strong>. Il n'est plus affiché ni analysé. Pour le
          réafficher : Paramètres › Dépôts suivis › Masqués › <Strong>Réafficher</Strong>.
        </P>

        <H3>Favoris, filtres et tri</H3>
        <P>
          Cliquez sur l'<Strong>étoile</Strong> d'un dépôt pour l'épingler : il apparaît en tête de liste et dans la barre latérale. Les filtres (Échecs, En cours,
          Réussis, Favoris, Sans CI) et le tri (activité, statut, nom) se combinent avec la recherche <Kbd>/</Kbd>.
        </P>
      </>
    ),
  },
  {
    id: "overview",
    title: "Vue d'ensemble",
    icon: LayoutDashboard,
    summary: "Le tableau de bord : indicateurs, échecs à corriger, activité.",
    content: (
      <>
        <P>La page d'accueil résume l'état de tous vos pipelines.</P>
        <Table
          head={["Bloc", "Contenu"]}
          rows={[
            ["Indicateurs", "Dépôts avec CI, exécutions en cours, workflows en échec, taux de réussite sur les exécutions récentes."],
            ["À corriger", "Chaque workflow dont la dernière exécution a échoué, avec le commit en cause. « Voir l'erreur » ouvre directement le diagnostic."],
            ["En direct", "Les exécutions en cours, avec leur durée qui défile."],
            ["Activité récente", "Les dernières exécutions de tous vos dépôts, des plus récentes aux plus anciennes."],
            ["Santé des dépôts", "Les dépôts triés par gravité, avec les 10 dernières exécutions en mini-barres colorées."],
          ]}
        />
      </>
    ),
  },
  {
    id: "repository",
    title: "Page d'un dépôt",
    icon: Workflow,
    summary: "Workflows ou pipelines, historique et fichiers YAML.",
    content: (
      <>
        <P>Cliquez sur un dépôt pour ouvrir sa page. Trois onglets :</P>
        <H3>Workflows / Pipelines</H3>
        <P>
          GitHub affiche une carte par workflow ; GitLab et Bitbucket, qui n'ont qu'un fichier de configuration par dépôt, une seule carte « Pipeline ». Chaque carte montre le statut et détails de la dernière exécution (commit, branche, déclencheur, durée) et une <Strong>barre d'historique</Strong> des 12
          dernières exécutions. Chaque barre est cliquable ; les barres plus hautes signalent les échecs.
        </P>
        <H3>Exécutions</H3>
        <P>
          L'historique complet, filtrable par workflow (colonne de gauche) et par statut. <Strong>Charger plus</Strong> remonte dans le temps.
        </P>
        <H3>Fichiers CI</H3>
        <P>
          Le fichier de configuration avec coloration syntaxique, et un résumé automatique : <Strong>déclencheurs</Strong> (push, pull ou merge request,
          planification, tag…), <Strong>stages</Strong> (GitLab) ou sections du pipeline (Bitbucket), <Strong>jobs</Strong> avec leurs dépendances et fichiers{" "}
          <Strong>inclus</Strong> (<Code>include:</Code> GitLab). Un YAML invalide est signalé avec la ligne en cause.
        </P>
        <Callout variant="info">L'édition directe des workflows (avec commit et pull request) arrive dans une prochaine version.</Callout>
      </>
    ),
  },
  {
    id: "runs",
    title: "Suivre une exécution",
    icon: Activity,
    summary: "Statuts, suivi en direct, jobs et étapes.",
    content: (
      <>
        <P>
          La page d'une exécution affiche en en-tête le commit, l'auteur, le déclencheur, la branche et la durée. En dessous : la liste des <Strong>jobs</Strong> à
          gauche, le détail du job sélectionné à droite.
        </P>
        <H3>Signification des statuts</H3>
        <div className="my-4 grid gap-2 sm:grid-cols-2">
          {STATES.map((state) => (
            <div key={state} className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5">
              <StatusIcon state={state} className="mt-0.5" />
              <div>
                <div className="text-[13px] font-medium text-fg">{STATE_LABELS[state]}</div>
                <div className="text-[12.5px] leading-snug text-fg-muted">{STATE_HELP[state]}</div>
              </div>
            </div>
          ))}
        </div>
        <H3>En direct</H3>
        <P>
          Pendant une exécution, la page se met à jour toutes les 3 secondes : barre de progression, étape en cours, durée. Le job qui tourne est sélectionné
          automatiquement. Une notification s'affiche quand l'exécution se termine.
        </P>
        <H3>Logs en direct</H3>
        <P>
          Sur <Strong>GitLab</Strong> et <Strong>Bitbucket</Strong>, le log d'un job s'affiche et défile pendant son exécution (badge <Strong>En direct</Strong>).
          Remontez dans le log pour le figer ; cliquez sur <Strong>Suivre</Strong> pour reprendre le défilement.
        </P>
        <Callout variant="warning" title="GitHub : pourquoi le log n'apparaît-il qu'à la fin du job ?">
          L'API de GitHub ne publie le log d'un job qu'une fois celui-ci terminé. Pendant l'exécution, Easy CI affiche donc l'avancement étape par étape ; le log
          complet se charge tout seul dès la fin du job. Pour voir la sortie brute en direct, utilisez l'icône <ExternalLink className="inline size-3" /> « Voir
          ce job sur GitHub ».
        </Callout>
        <H3>Jobs et étapes</H3>
        <P>
          Cliquez sur un job pour afficher son log. Sur GitHub, ses étapes s'affichent aussi : cliquer sur une étape fait défiler le log jusqu'à la section
          correspondante. Sur GitLab, les jobs sont regroupés par <Strong>stage</Strong> ; un job dont l'échec est autorisé (<Code>allow_failure</Code>) porte le
          badge « autorisé » et ne fait pas échouer le pipeline.
        </P>
      </>
    ),
  },
  {
    id: "errors",
    title: "Comprendre un échec",
    icon: ScrollText,
    summary: "Résumé des erreurs, extrait du log et outils de lecture.",
    content: (
      <>
        <P>Quand une exécution échoue, Easy CI fait le travail de recherche à votre place.</P>
        <H3>Le résumé des erreurs</H3>
        <P>Un encadré rouge apparaît en haut de la page, avec pour chaque job en échec :</P>
        <ul className="my-3 ml-5 list-disc space-y-1 text-[13.5px] leading-relaxed text-fg-muted marker:text-fg-subtle">
          <li>
            les <Strong>annotations</Strong> : message d'erreur, fichier et ligne en cause. GitHub les fournit directement ; sur GitLab, Easy CI lit les rapports de
            tests JUnit (<Code>artifacts:reports:junit</Code>) et la raison d'échec du job ;
          </li>
          <li>
            un <Strong>extrait du log</Strong> : les lignes qui précèdent l'erreur (sortie du test, stack trace…), cliquables. Sans ligne d'erreur explicite
            (fréquent sur Bitbucket), ce sont les dernières lignes avant l'arrêt ;
          </li>
          <li>
            le bouton <Strong>Voir dans les logs</Strong>, qui ouvre le log complet directement sur l'erreur.
          </li>
        </ul>
        <H3>Lire un log</H3>
        <Table
          head={["Outil", "Usage"]}
          rows={[
            ["Aller à l'erreur", "Saute à la ligne d'erreur ; cliquez à nouveau pour passer à la suivante."],
            [
              <>
                Recherche <Kbd>⌘</Kbd> <Kbd>F</Kbd>
              </>,
              <>
                Surligne toutes les occurrences. <Kbd>Entrée</Kbd> pour la suivante, <Kbd>⇧</Kbd> <Kbd>Entrée</Kbd> pour la précédente.
              </>,
            ],
            ["Sections repliables", "GitHub : blocs techniques repliés par défaut. GitLab : sections du runner. Bitbucket : une section par commande. Cliquez pour replier ou déplier."],
            ["Horodatage", "Affiche l'heure de chaque ligne pour repérer les étapes lentes."],
            ["Retour à la ligne", "Active ou non le retour à la ligne des lignes longues."],
            ["Copier", "Copie le log complet dans le presse-papiers."],
          ]}
        />
        <P>
          Les lignes d'erreur portent un badge rouge <Strong>Erreur</Strong>, les avertissements un badge orange. Les couleurs produites par vos outils (tests, linters)
          sont conservées.
        </P>
        <Callout variant="info">Pour les logs très volumineux, seules les 20 000 dernières lignes sont affichées : c'est là que se trouvent les erreurs.</Callout>
      </>
    ),
  },
  {
    id: "actions",
    title: "Relancer et annuler",
    icon: RotateCcw,
    summary: "Relancer tout ou partie d'une exécution, annuler.",
    content: (
      <>
        <Table
          head={["Action", "Effet"]}
          rows={[
            ["Relancer les jobs en échec", "GitHub et GitLab : rejoue uniquement les jobs en échec (et ceux qui en dépendent) dans la même exécution."],
            ["Relancer tous les jobs (GitHub)", "Nouvelle tentative de toute l'exécution, sur le même commit (badge « Tentative 2 »)."],
            ["Lancer un nouveau pipeline (GitLab, Bitbucket)", "Crée un nouveau pipeline sur la même branche, avec son dernier commit. Easy CI l'ouvre automatiquement."],
            ["Annuler", "Visible pendant une exécution : arrête les jobs en cours."],
          ]}
        />
        <Callout variant="warning">
          Ces actions agissent sur vos vrais pipelines et nécessitent des droits en écriture : <Code>repo</Code> (GitHub classique) ou <Strong>Actions : Read and
          write</Strong> (fine-grained), <Code>api</Code> (GitLab), <Code>write:pipeline:bitbucket</Code> (Bitbucket).
        </Callout>
      </>
    ),
  },
  {
    id: "local",
    title: "Projets locaux",
    icon: Laptop,
    summary: "Relier les dépôts à leurs clones, suivre et récupérer les changements.",
    content: (
      <>
        <P>
          Easy CI relie chaque dépôt suivi à son <Strong>clone sur votre machine</Strong>. C'est dans ce dossier que se feront les modifications de pipelines
          (prochaines versions) : elles seront écrites et commitées localement, puis envoyées seulement quand vous le décidez.
        </P>
        <Callout variant="info" title="Prérequis">
          Git doit être installé. Easy CI utilise votre Git et vos identifiants habituels (clé SSH, trousseau, gestionnaire d'identifiants) : si{" "}
          <Code>git fetch</Code> fonctionne dans votre terminal, il fonctionne dans Easy CI.
        </Callout>

        <H3>1. Indiquer vos dossiers de projets</H3>
        <Steps>
          <>
            <Strong>Paramètres › Projets locaux</Strong> › saisissez le dossier qui contient vos projets (par exemple <Code>~/Developer</Code>) ou cliquez sur{" "}
            <Strong>Parcourir…</Strong>, puis <Strong>Ajouter</Strong>.
          </>
          <>
            Easy CI parcourt ce dossier (jusqu'à 6 niveaux, en ignorant <Code>node_modules</Code>, <Code>.venv</Code>, <Code>build</Code>…) et lit les remotes de
            chaque clone Git trouvé.
          </>
          <>
            Chaque clone dont un remote pointe vers un dépôt suivi (GitHub, GitLab, Bitbucket, en HTTPS ou SSH) lui est <Strong>relié automatiquement</Strong>. Une
            icône d'ordinateur apparaît alors sur la ligne du dépôt.
          </>
        </Steps>
        <P>Ajoutez un nouveau projet sur le disque ? Cliquez sur <Strong>Relancer la détection</Strong>.</P>

        <H3>2. Lier ou cloner un dépôt à la main</H3>
        <P>Page du dépôt › onglet <Strong>Projet local</Strong> :</P>
        <Table
          head={["Action", "Usage"]}
          rows={[
            ["Lier un dossier existant", "Le clone est ailleurs que dans vos dossiers de projets. Easy CI vérifie que ses remotes correspondent au dépôt ; sinon il vous propose de lier quand même."],
            ["Cloner le dépôt", "Pas encore de copie locale : choisissez le dossier parent et le protocole (HTTPS ou SSH). Le clone est relié dès la fin."],
            ["Délier", "Menu ⋯ › Délier ce dossier. Le dossier n'est ni modifié ni supprimé, et n'est plus relié automatiquement."],
          ]}
        />

        <H3>3. Suivre l'état du clone</H3>
        <Table
          head={["Indicateur", "Signification"]}
          rows={[
            ["À récupérer", "Commits présents sur la branche distante suivie mais pas encore dans votre branche locale."],
            ["À pousser", "Commits locaux pas encore envoyés sur la branche distante."],
            ["Non commités", "Fichiers modifiés, ajoutés ou supprimés dans la copie de travail."],
            ["Dernière récupération", "Date du dernier git fetch, par vous ou par la récupération automatique."],
          ]}
        />
        <P>
          La section <Strong>Fichiers CI locaux</Strong> compare chaque fichier de configuration CI à la branche distante. Cliquez sur un fichier modifié pour
          afficher les différences ligne à ligne (<span className="text-failure">−</span> distant, <span className="text-success">+</span> local).
        </P>
        <div className="my-4 grid gap-2 sm:grid-cols-2">
          {(Object.keys(CI_STATE_INFO) as CiFileState[]).map((state) => (
            <div key={state} className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5">
              <CiStateBadge state={state} />
              <div className="text-[12.5px] leading-snug text-fg-muted">{CI_STATE_INFO[state].description}</div>
            </div>
          ))}
        </div>

        <H3>4. Récupérer et mettre à jour</H3>
        <Table
          head={["Bouton", "Effet"]}
          rows={[
            ["Récupérer", <>Lance <Code>git fetch</Code> : met à jour les indicateurs sans toucher à vos fichiers.</>],
            [
              "Mettre à jour",
              <>
                Lance <Code>git pull --ff-only</Code> : avance la branche locale. Désactivé s'il y a des modifications non commitées, des commits locaux non poussés
                (branches divergentes) ou aucune branche distante suivie.
              </>,
            ],
            ["Ouvrir", "Menu ⋯ : afficher le dossier, l'ouvrir dans votre éditeur de code (VS Code, Cursor, Zed, JetBrains…) ou dans un terminal."],
          ]}
        />
        <Callout variant="tip" title="Récupération automatique">
          Paramètres › Projets locaux : Easy CI peut récupérer les nouveautés toutes les 5, 15 ou 60 minutes, et même <Strong>mettre à jour les branches</Strong>{" "}
          automatiquement. Cette mise à jour ne se fait qu'en avance rapide et jamais si vous avez du travail en cours : vos modifications ne sont jamais écrasées.
        </Callout>
      </>
    ),
  },
  {
    id: "refresh",
    title: "Actualisation et quota",
    icon: Gauge,
    summary: "Fréquence de mise à jour et limites d'appels des plateformes.",
    content: (
      <>
        <P>
          Les dépôts sont revérifiés automatiquement selon la fréquence choisie dans Paramètres › Synchronisation (1 minute par défaut). Les dépôts dont une exécution
          est en cours sont suivis toutes les 8 secondes. Appuyez sur <Kbd>R</Kbd> pour tout actualiser immédiatement.
        </P>
        <P>
          Chaque plateforme limite le nombre d'appels : <Strong>5 000 par heure</Strong> pour GitHub, environ <Strong>2 000 par minute</Strong> pour gitlab.com
          (variable sur une instance auto-hébergée), <Strong>1 000 par heure</Strong> pour Bitbucket. Easy CI limite les analyses simultanées, met en cache les
          pipelines terminés et utilise des requêtes conditionnelles. Les jauges <Strong>Quota</Strong> en bas de la barre latérale indiquent la consommation quand
          la plateforme la communique.
        </P>
      </>
    ),
  },
  {
    id: "shortcuts",
    title: "Raccourcis clavier",
    icon: Keyboard,
    summary: "Naviguer et agir sans la souris.",
    content: (
      <Table
        head={["Raccourci", "Action"]}
        rows={[
          [<><Kbd>⌘</Kbd> <Kbd>K</Kbd></>, "Palette de commandes : dépôts, pages, thème, actualisation, déconnexion."],
          [<Kbd>/</Kbd>, "Rechercher (champ de filtre de la page, sinon palette)."],
          [<Kbd>R</Kbd>, "Tout actualiser."],
          [<><Kbd>⌘</Kbd> <Kbd>F</Kbd></>, "Rechercher dans le log affiché."],
          [<><Kbd>Entrée</Kbd> / <Kbd>⇧</Kbd> <Kbd>Entrée</Kbd></>, "Occurrence suivante / précédente dans le log."],
          [<Kbd>Échap</Kbd>, "Fermer la palette ou une fenêtre, effacer la recherche du log."],
        ]}
      />
    ),
  },
  {
    id: "settings",
    title: "Paramètres",
    icon: Settings,
    summary: "Compte, dépôts suivis, apparence, synchronisation.",
    content: (
      <Table
        head={["Section", "Réglages"]}
        rows={[
          ["Comptes", "Un compte par plateforme : connexion, déconnexion, stockage des identifiants, messages en cas d'identifiants expirés."],
          ["Dépôts suivis", "Dépôts ajoutés manuellement et dépôts masqués."],
          ["Projets locaux", "Dossiers de projets, détection des clones, récupération et mise à jour automatiques, éditeur de code."],
          ["Apparence", "Thème clair, sombre ou identique au système."],
          ["Synchronisation", "Fréquence d'actualisation (30 s à 5 min, ou manuelle), affichage des dépôts sans CI et des dépôts archivés."],
        ]}
      />
    ),
  },
  {
    id: "troubleshooting",
    title: "Dépannage",
    icon: CircleHelp,
    summary: "Les problèmes courants et leurs solutions.",
    content: (
      <>
        <Question question="« Identifiants invalides ou expirés »">
          <P>
            Le token a expiré, a été révoqué ou mal copié. Seul le compte concerné est déconnecté. Créez un nouveau token (sections Connecter GitHub, GitLab,
            Bitbucket) puis Paramètres › Comptes › <Strong>Connecter</Strong>.
          </P>
        </Question>
        <Question question="Bitbucket refuse mes identifiants">
          <P>
            Avec un API token personnel, le champ attend l'<Strong>adresse e-mail de votre compte Atlassian</Strong>, pas votre nom d'utilisateur Bitbucket. Vérifiez
            aussi que le token a été créé pour l'application Bitbucket, avec les droits de lecture listés dans la section Connecter Bitbucket.
          </P>
        </Question>
        <Question question="Un projet GitLab n'a pas de pipeline détecté">
          <P>
            Easy CI cherche le fichier défini dans Settings › CI/CD › <i>CI/CD configuration file</i> (par défaut <Code>.gitlab-ci.yml</Code>) sur la branche par défaut.
            Vérifiez aussi que CI/CD est activé pour le projet et que votre rôle permet de voir les pipelines (Reporter ou plus).
          </P>
        </Question>
        <Question question="Un dépôt de mon organisation n'apparaît pas">
          <P>Dans l'ordre, vérifiez que :</P>
          <ul className="ml-5 list-disc space-y-1 text-[13.5px] leading-relaxed text-fg-muted">
            <li>
              le token classique possède le droit <Code>read:org</Code> ;
            </li>
            <li>
              le token est <Strong>autorisé pour le SSO</Strong> de l'organisation (Configure SSO › Authorize) ;
            </li>
            <li>pour un token fine-grained : l'organisation est bien le « Resource owner » et le dépôt est inclus ;</li>
            <li>le dépôt n'est ni archivé (voir Paramètres) ni masqué.</li>
          </ul>
          <P>
            Vous pouvez aussi l'ajouter manuellement avec <Strong>Ajouter un dépôt</Strong> : le message d'erreur indiquera si le token n'y a pas accès.
          </P>
        </Question>
        <Question question="« Accès refusé » en relançant ou en annulant">
          <P>
            Le token n'a que des droits de lecture. GitHub : <Code>repo</Code> ou <Strong>Actions : Read and write</Strong>. GitLab : <Code>api</Code> et un rôle
            Developer ou plus. Bitbucket : <Code>write:pipeline:bitbucket</Code>.
          </P>
        </Question>
        <Question question="« Limite d'appels à l'API atteinte »">
          <P>
            Le quota horaire est épuisé, souvent à cause d'un grand nombre de dépôts ou d'autres outils utilisant le même compte. Il se réinitialise en moins d'une
            heure. Espacez l'actualisation (Paramètres › Synchronisation) et masquez les dépôts inutiles.
          </P>
        </Question>
        <Question question="Le log reste vide pendant l'exécution">
          <P>
            Sur GitHub, c'est normal : le log n'est publié qu'à la fin du job, l'avancement des étapes reste visible en direct. Sur GitLab et Bitbucket, le log apparaît
            dès que le runner a démarré le job.
          </P>
        </Question>
        <Question question="Je dois me reconnecter à chaque lancement (Linux)">
          <P>
            Aucun trousseau n'est disponible sur le système. Installez et démarrez un service compatible Secret Service (GNOME Keyring, KWallet), ou définissez la
            variable d'environnement de la plateforme (<Code>EASY_CI_GITHUB_TOKEN</Code>, <Code>EASY_CI_GITLAB_TOKEN</Code>…).
          </P>
        </Question>
        <Question question="Un clone local n'est pas relié à son dépôt">
          <P>
            Vérifiez que son dossier se trouve dans un dossier de projets (à moins de 6 niveaux, hors dossiers ignorés) et qu'un de ses remotes pointe vers le dépôt
            (<Code>git remote -v</Code>). Pour GitLab auto-hébergé, le compte de l'instance doit être connecté. Sinon, liez-le à la main depuis l'onglet Projet local.
          </P>
        </Question>
        <Question question="« Git n'a pas pu s'authentifier » en récupérant ou en clonant">
          <P>
            Easy CI ne peut pas afficher de demande de mot de passe. Configurez un accès sans question : clé SSH chargée dans l'agent, ou gestionnaire d'identifiants
            Git (<Code>gh auth setup-git</Code> pour GitHub, Git Credential Manager…). Vérifiez ensuite que <Code>git fetch</Code> fonctionne dans un terminal.
          </P>
        </Question>
        <Question question="« Le moteur Easy CI ne répond pas »">
          <P>L'interface ne parvient pas à joindre le moteur Python. Fermez puis relancez l'application ; si le problème persiste, lancez-la depuis un terminal :</P>
          <CodeBlock>easy-ci --debug</CodeBlock>
        </Question>
      </>
    ),
  },
  {
    id: "privacy",
    title: "Confidentialité",
    icon: ShieldCheck,
    summary: "Ce qui est stocké, et où.",
    content: (
      <>
        <P>
          Easy CI fonctionne entièrement sur votre ordinateur : pas de compte Easy CI, pas de serveur intermédiaire. L'application communique uniquement avec les
          plateformes que vous connectez (<Code>api.github.com</Code>, votre instance GitLab, <Code>api.bitbucket.org</Code>).
        </P>
        <Table
          head={["Donnée", "Emplacement"]}
          rows={[
            ["Identifiants (tokens, e-mail Bitbucket)", "Trousseau sécurisé du système, une entrée par plateforme."],
            [
              "Préférences (thème, favoris, dépôts ajoutés ou masqués)",
              <>
                <Code>settings.json</Code> dans <Code>~/Library/Application Support/Easy CI</Code> (macOS), <Code>%LOCALAPPDATA%\Easy CI</Code> (Windows),{" "}
                <Code>~/.config/Easy CI</Code> (Linux).
              </>,
            ],
            ["Dossiers de projets et liaisons dépôt ↔ dossier", <><Code>settings.json</Code> (chemins uniquement : le contenu de vos projets n'est jamais copié).</>],
            ["Dépôts, exécutions, logs", "En mémoire uniquement, le temps de la session."],
          ]}
        />
      </>
    ),
  },
];
