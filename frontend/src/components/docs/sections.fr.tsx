// Documentation intégrée — version française. La version anglaise (sections.en.tsx) doit garder les mêmes sections et identifiants.
import {
  Activity,
  Bell,
  BookOpen,
  ChartColumn,
  CircleArrowUp,
  CircleHelp,
  ExternalLink,
  FolderGit2,
  Gauge,
  GitBranch,
  GitCompareArrows,
  KeyRound,
  FilePlus2,
  Keyboard,
  Laptop,
  Pencil,
  LayoutDashboard,
  RotateCcw,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { CI_FILE_STATES, ciStateInfo, CiStateBadge } from "@/components/local/LocalProjectPanel";
import { stateLabel, StatusIcon } from "@/components/status";
import { Kbd } from "@/components/ui/primitives";
import type { ProviderId, RunStateName } from "@/lib/types";
import { Callout, Code, CodeBlock, ExternalButton, H3, P, Question, Steps, Strong, Table, type DocSection } from "./primitives";

const CLASSIC_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,workflow,read:org&description=Easy%20CI";
const FINE_GRAINED_URL = "https://github.com/settings/personal-access-tokens/new";

function GitHubGuide() {
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
              ["Pull requests", "Read and write", "Créer une pull request après modification de la CI (facultatif)."],
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

function GitLabGuide() {
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

function BitbucketGuide() {
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
              [<Code>write:pullrequest:bitbucket</Code>, "Créer des pull requests depuis l'éditeur (facultatif)."],
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
        <P>Cliquez sur un dépôt pour ouvrir sa page. Plusieurs onglets :</P>
        <H3>Workflows / Pipelines</H3>
        <P>
          GitHub affiche une carte par workflow ; GitLab et Bitbucket, qui n'ont qu'un fichier de configuration par dépôt, une seule carte « Pipeline ». Chaque carte montre le statut et détails de la dernière exécution (commit, branche, déclencheur, durée) et une <Strong>barre d'historique</Strong> des 12
          dernières exécutions. Chaque barre est cliquable ; les barres plus hautes signalent les échecs.
        </P>
        <H3>Exécutions</H3>
        <P>
          L'historique complet, filtrable par workflow (colonne de gauche) et par statut. <Strong>Charger plus</Strong> remonte dans le temps.
        </P>
        <H3>Statistiques</H3>
        <P>
          Durées, taux de réussite et jobs instables sur les dernières exécutions terminées (voir Statistiques des exécutions).
        </P>
        <H3>Fichiers CI</H3>
        <P>
          Le fichier de configuration avec coloration syntaxique, et un résumé automatique : <Strong>déclencheurs</Strong> (push, pull ou merge request,
          planification, tag…), <Strong>stages</Strong> (GitLab) ou sections du pipeline (Bitbucket), <Strong>jobs</Strong> avec leurs dépendances et fichiers{" "}
          <Strong>inclus</Strong> (<Code>include:</Code> GitLab). Un YAML invalide est signalé avec la ligne en cause.
        </P>
        <P>
          Le bouton <Strong>Modifier</Strong> ouvre le fichier dans l'éditeur, à condition qu'un dossier local soit lié au dépôt (voir Modifier la CI).
        </P>
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
                <div className="text-[13px] font-medium text-fg">{stateLabel(state)}</div>
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
    id: "compare",
    title: "Comparer deux exécutions",
    icon: GitCompareArrows,
    summary: "Ce qui a changé depuis la dernière réussite : jobs, durées, commits.",
    content: (
      <>
        <P>
          Le bouton <Strong>Comparer</Strong>, en haut d'une exécution terminée, répond à la question « qu'est-ce qui a changé depuis que ça marchait ? ». Easy CI
          choisit une référence et affiche l'écart entre les deux exécutions.
        </P>
        <H3>La référence</H3>
        <Table
          head={["Exécution comparée", "Référence proposée"]}
          rows={[
            ["En échec ou annulée", "La dernière exécution réussie du même workflow qui la précède, sur la même branche, sinon sur la branche par défaut."],
            ["Réussie", "L'exécution terminée (réussie ou en échec) qui la précède : utile pour suivre les durées."],
          ]}
        />
        <P>
          Le bouton <Strong>Changer</Strong> permet de choisir une autre exécution du même workflow, puis de revenir à la référence automatique.
        </P>
        <H3>Ce qui est comparé</H3>
        <Table
          head={["Élément", "Détail"]}
          rows={[
            ["Jobs", "Rapprochés par leur nom : cassé, réparé, toujours en échec, nouveau, supprimé, statut modifié. Sur GitHub, l'étape en échec est indiquée. Cliquez sur un job pour ouvrir son log."],
            ["Durées", "Durée totale et écart par job. Un job est « plus lent » ou « plus rapide » au-delà de 30 secondes et de 25 % d'écart."],
            ["Commits", "Les commits de l'exécution comparée absents de la référence, avec leur auteur. Voir le diff ouvre la comparaison sur la plateforme."],
            ["Fichiers", "Fichiers modifiés et lignes ajoutées ou supprimées. Les fichiers de configuration CI sont signalés et placés en tête."],
          ]}
        />
        <Callout variant="warning" title="Même commit, résultat différent ?">
          Si les deux exécutions portent sur le même commit, le code n'y est pour rien : Easy CI le signale. L'échec vient probablement d'un test instable, d'une
          dépendance externe ou du runner (voir Statistiques des exécutions).
        </Callout>
        <Callout variant="info">
          Les commits sont demandés à la plateforme (un appel par comparaison, gardé en mémoire pendant la session). Si un commit a disparu, par exemple après un
          force push, la comparaison des jobs reste affichée.
        </Callout>
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
    id: "stats",
    title: "Statistiques des exécutions",
    icon: ChartColumn,
    summary: "Durées dans le temps, taux de réussite, jobs lents ou instables.",
    content: (
      <>
        <P>
          L'onglet <Strong>Statistiques</Strong> d'un dépôt résume ses dernières exécutions terminées : 20, 50 ou 100, pour tous les workflows ou un seul (colonne de
          gauche), sur toutes les branches ou seulement la branche par défaut. Les calculs se font sur votre machine, à partir des données déjà fournies par la
          plateforme : rien n'est envoyé ailleurs.
        </P>
        <Table
          head={["Indicateur", "Signification"]}
          rows={[
            ["Taux de réussite", "Exécutions réussies parmi celles qui ont réussi ou échoué (les annulations ne comptent pas)."],
            ["Durée médiane", "La moitié des exécutions est plus rapide. La tendance compare les exécutions récentes aux plus anciennes (à partir de 5 % d'écart)."],
            ["Durée P90", "9 exécutions sur 10 sont plus rapides : utile pour repérer les lenteurs occasionnelles."],
            ["Jobs instables", "Nombre de jobs dont le résultat varie sans changement de code."],
          ]}
        />
        <H3>Graphique des durées</H3>
        <P>
          Une barre par exécution, de la plus ancienne à la plus récente, colorée selon son résultat, avec la médiane en pointillés. Survolez une barre pour voir le
          numéro, le commit, la branche et la durée ; cliquez pour ouvrir l'exécution.
        </P>
        <H3>Jobs</H3>
        <P>
          Pour chaque job : taux de réussite, durée médiane et P90, et historique de ses résultats. Un point orange au-dessus d'un résultat signale plusieurs
          tentatives. Le filtre <Strong>Instable</Strong> ne garde que les jobs à surveiller.
        </P>
        <Callout variant="warning" title="Quand un job est-il instable ?">
          Quand il a <Strong>échoué puis réussi sur le même commit</Strong>, après une relance du job ou du pipeline, sans modification du code : c'est la signature
          d'un test « flaky ». Ou quand il <Strong>alterne souvent</Strong> entre succès et échec (au moins 4 changements, soit un pour 5 exécutions). Un job cassé
          puis corrigé par un nouveau commit n'est pas instable.
        </Callout>
        <Callout variant="info">
          Les jobs de chaque exécution terminée ne sont téléchargés qu'une fois puis gardés en mémoire pendant la session : changer de filtre ne consomme presque pas
          de quota.
        </Callout>
      </>
    ),
  },
  {
    id: "notifications",
    title: "Notifications",
    icon: Bell,
    summary: "Être prévenu quand un pipeline échoue ou repasse au vert.",
    content: (
      <>
        <P>
          Easy CI surveille les dépôts affichés à chaque actualisation et signale les <Strong>changements d'état</Strong> de chaque workflow : passage en échec
          (alors qu'il était au vert) et retour au vert (après un échec). Un pipeline qui échoue plusieurs fois de suite n'est signalé qu'une fois.
        </P>
        <Table
          head={["Fenêtre", "Ce qui s'affiche"]}
          rows={[
            ["Au premier plan", "Un message dans l'application, avec un bouton Voir qui ouvre l'exécution."],
            ["En arrière-plan ou réduite", "Le même message, plus une notification du système. Les dépôts continuent d'être actualisés."],
          ]}
        />
        <P>
          Au-delà de 3 changements lors d'une même actualisation, un seul message les résume. Rien n'est signalé au démarrage : l'état du moment sert de
          référence.
        </P>
        <H3>Réglages</H3>
        <P>
          Dans <Strong>Paramètres › Notifications</Strong> : activer ou non les notifications, choisir les échecs et/ou les retours au vert, limiter aux dépôts
          favoris, et envoyer une <Strong>notification d'essai</Strong>.
        </P>
        <Table
          head={["Système", "Mécanisme"]}
          rows={[
            ["macOS", "Centre de notifications, au nom d'« Éditeur de script » (application non signée). Si rien ne s'affiche : Réglages Système › Notifications › Éditeur de script."],
            ["Windows", "Notifications Windows, affichées au nom de Windows PowerShell. Vérifiez que les notifications et le mode Concentration le permettent."],
            ["Linux", "notify-send (paquet libnotify-bin ou libnotify), sinon D-Bus. Sans service de notification, seuls les messages dans l'application s'affichent."],
          ]}
        />
        <Callout variant="tip">
          Pour vérifier depuis un terminal, lancez l'application avec <Code>--test-notification</Code> : elle affiche une notification d'essai et indique le
          mécanisme utilisé.
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
          Easy CI relie chaque dépôt suivi à son <Strong>clone sur votre machine</Strong>. C'est dans ce dossier que se font les modifications de pipelines :
          elles sont écrites et commitées localement, puis envoyées seulement quand vous le décidez (voir Modifier la CI).
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
          {CI_FILE_STATES.map((state) => (
            <div key={state} className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5">
              <CiStateBadge state={state} />
              <div className="text-[12.5px] leading-snug text-fg-muted">{ciStateInfo(state).description}</div>
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
    id: "editing",
    title: "Modifier la CI",
    icon: Pencil,
    summary: "Éditer en local, valider, commiter, envoyer et proposer une pull request.",
    content: (
      <>
        <P>
          Les fichiers CI se modifient <Strong>dans le clone local</Strong> du dépôt, jamais directement sur la plateforme. Chaque étape est une action distincte :
          rien ne quitte votre machine tant que vous ne cliquez pas sur <Strong>Envoyer</Strong>.
        </P>
        <Steps>
          <>
            <Strong>Ouvrir l'éditeur</Strong> : onglet Projet local › icône crayon d'un fichier (ou « Ouvrir l'éditeur »), ou onglet Fichiers CI › <Strong>Modifier</Strong>.
            Sur GitHub, l'icône <FilePlus2 className="inline size-3.5" /> crée un nouveau workflow à partir d'un modèle.
          </>
          <>
            <Strong>Éditer</Strong> : coloration YAML, indentation automatique, repli des blocs, recherche (<Kbd>⌘</Kbd> <Kbd>F</Kbd>) et suggestion des mots-clés de la
            plateforme (<Kbd>Ctrl</Kbd> <Kbd>Espace</Kbd>).
          </>
          <>
            <Strong>Valider</Strong> : chaque modification est vérifiée en direct. Les erreurs sont soulignées dans le texte et listées dans l'onglet Validation ;
            un clic place le curseur sur la ligne. Sur GitLab, <Strong>Valider avec GitLab</Strong> interroge aussi l'outil officiel CI Lint.
          </>
          <>
            <Strong>Enregistrer</Strong> (<Kbd>⌘</Kbd> <Kbd>S</Kbd>) : le fichier est écrit dans le dossier local. Si un autre éditeur l'a modifié entre-temps, Easy CI
            vous demande de recharger ou d'écraser.
          </>
          <>
            <Strong>Commiter</Strong> : choisissez les fichiers, le message et la branche. Depuis la branche principale, une <Strong>nouvelle branche</Strong> est
            proposée (<Code>ci/…</Code>). Le commit est seulement local ; les autres fichiers modifiés du projet ne sont pas inclus.
          </>
          <>
            <Strong>Envoyer</Strong> : la carte « Branche et publication » affiche les commits en attente. Le bouton <Strong>Envoyer…</Strong> demande confirmation
            puis pousse la branche avec votre Git habituel.
          </>
          <>
            <Strong>Proposer</Strong> : <Strong>Créer…</Strong> ouvre une pull request (merge request sur GitLab) vers la branche principale, avec titre, description
            et option brouillon. Si une proposition existe déjà pour la branche, Easy CI l'affiche au lieu d'en créer une seconde.
          </>
        </Steps>

        <H3>Ce que vérifie la validation</H3>
        <Table
          head={["Plateforme", "Contrôles"]}
          rows={[
            ["Toutes", "Syntaxe YAML (tabulations, indentation, guillemets), expressions ${{ }} non refermées, clés inconnues (avertissement)."],
            ["GitHub Actions", "on et jobs présents, runs-on, steps non vides, « uses » ou « run » par étape, version des actions (@v4), needs existants et sans boucle, cron à 5 champs."],
            ["GitLab CI", "script ou trigger par job, stages déclarés, needs et extends existants, rules incompatible avec only/except, valeurs de when. Validation officielle CI Lint en option."],
            ["Bitbucket Pipelines", "Section pipelines, sections connues, script dans chaque step, size, trigger et max-time valides."],
          ]}
        />
        <Callout variant="info">
          Un fichier qui contient des erreurs peut être enregistré (travail en cours) mais le commit est déconseillé : Easy CI le signale et demande une confirmation
          explicite.
        </Callout>

        <H3>Annuler une modification</H3>
        <Table
          head={["Bouton", "Effet"]}
          rows={[
            ["Annuler", "Revient au contenu enregistré sur le disque (modifications de l'éditeur non enregistrées)."],
            ["Restaurer", "Revient à la dernière version commitée (git restore). Pour un nouveau fichier jamais commité, le supprime. Demande confirmation."],
          ]}
        />

        <H3>Droits nécessaires</H3>
        <P>
          L'envoi utilise vos identifiants Git (SSH ou gestionnaire d'identifiants). La création de pull request utilise le compte connecté : <Code>repo</Code> ou{" "}
          <Strong>Pull requests : Read and write</Strong> (GitHub), <Code>api</Code> (GitLab), <Code>write:pullrequest:bitbucket</Code> (Bitbucket).
        </P>
      </>
    ),
  },
  {
    id: "generate",
    title: "Générer un pipeline",
    icon: Zap,
    summary: "Créer une CI adaptée à la stack du projet en quelques clics, sans IA.",
    content: (
      <>
        <P>
          L'assistant de génération analyse les fichiers du <Strong>clone local</Strong> et produit un pipeline complet pour GitHub Actions, GitLab CI/CD ou Bitbucket
          Pipelines. Il repose uniquement sur des <Strong>modèles déterministes</Strong> : pas d'IA, aucun contenu envoyé à un service tiers, et les mêmes choix
          donnent toujours le même fichier.
        </P>
        <Steps>
          <>
            <Strong>Ouvrir l'assistant</Strong> : bouton <Strong>Générer un pipeline</Strong> sur un dépôt sans CI, bouton <Strong>Générer</Strong> de l'onglet Projet
            local, ou icône <Zap className="inline size-3.5" /> de l'éditeur. Un dossier local doit être lié au dépôt.
          </>
          <>
            <Strong>Analyse</Strong> : les stacks détectées s'affichent avec leur framework, leur version (et le fichier qui l'indique), le gestionnaire de paquets et
            les fichiers justificatifs. Désactivez une stack pour l'exclure. Un Dockerfile, des fichiers d'hébergement et une CI existante sont aussi signalés.
          </>
          <>
            <Strong>Étapes</Strong> : installation, lint, vérification des types, tests et build sont pré-remplis d'après vos scripts. Chaque commande se modifie ou se
            désactive. Vous pouvez tester plusieurs versions (matrice), activer le cache et, sur GitHub, plusieurs systèmes.
          </>
          <>
            <Strong>Déclencheurs</Strong> : push sur la branche principale, pull/merge requests, tags <Code>v*</Code>, lancement manuel, exécution planifiée et
            annulation des exécutions dépassées.
          </>
          <>
            <Strong>Livraison</Strong> (facultatif) : construction et envoi d'une image Docker (ghcr.io, registre GitLab, Docker Hub…) et job de déploiement avec
            environnement, secrets, validation manuelle. Des modèles de commande sont proposés quand un fichier Netlify, Vercel, Fly.io, Cloudflare, Render,
            Firebase ou Serverless est détecté.
          </>
          <>
            <Strong>Vérifier et écrire</Strong> : récapitulatif des jobs, actions à faire sur la plateforme (secrets à créer, planification…), puis{" "}
            <Strong>Écrire dans le dossier local</Strong>. Le fichier s'ouvre dans l'éditeur : relisez, commitez, envoyez et proposez-le comme toute modification.
          </>
        </Steps>
        <Callout variant="tip" title="Aperçu en direct">
          Le YAML généré s'affiche à droite pendant toute la configuration, validé à chaque changement. Le bouton copier permet aussi de le coller ailleurs.
        </Callout>

        <H3>Stacks reconnues</H3>
        <Table
          head={["Stack", "Détection", "Commandes déduites"]}
          rows={[
            ["Node.js", "package.json, lockfile npm / pnpm / Yarn / Bun, .nvmrc, engines", "scripts lint, typecheck, test, build ; tsc --noEmit si TypeScript"],
            ["Python", "pyproject.toml, requirements*.txt, uv.lock, poetry.lock, Pipfile, .python-version", "ruff / flake8, mypy / pyright, pytest ou manage.py test, build"],
            ["Go", "go.mod (version), .golangci.yml", "go vet ou golangci-lint, go test -race, go build"],
            ["Rust", "Cargo.toml, rust-toolchain.toml", "cargo fmt + clippy, cargo test, cargo build --release"],
            ["Java / Kotlin", "pom.xml, build.gradle(.kts), wrappers mvnw / gradlew", "mvn verify / gradle test, package / build"],
            ["Android", "plugin com.android dans Gradle", "gradlew lint, testDebugUnitTest, assembleDebug"],
            ["PHP", "composer.json (Laravel, Symfony)", "pint / php-cs-fixer, phpstan, phpunit / pest / artisan test"],
            ["Ruby", "Gemfile, .ruby-version (Rails)", "rubocop, rspec ou rails test"],
            [".NET", ".sln / .csproj (TargetFramework)", "dotnet format, dotnet test, dotnet build"],
          ]}
        />
        <P>
          Dans un monorepo, les sous-dossiers de premier niveau sont aussi analysés (par exemple <Code>frontend/</Code> et <Code>api/</Code>) : chaque stack obtient ses
          propres jobs, exécutés dans son dossier. Les paquets gérés par un workspace racine (npm, pnpm, Yarn, Cargo, modules Gradle) ne sont pas dupliqués.
        </P>

        <H3>Particularités par plateforme</H3>
        <Table
          head={["Plateforme", "Fichier généré"]}
          rows={[
            ["GitHub Actions", "Un workflow dans .github/workflows (nom modifiable), actions officielles à jour, permissions minimales, cache intégré aux actions setup-*, image Docker avec cache GitHub."],
            ["GitLab CI/CD", ".gitlab-ci.yml avec workflow:rules (sans pipelines en double), stages, modèle caché par stack (extends), parallel:matrix, rapport JUnit pour pytest, déploiement manuel via when: manual."],
            ["Bitbucket Pipelines", "bitbucket-pipelines.yml avec étapes définies une fois (ancres YAML) et réutilisées pour la branche principale, les pull requests, les tags et les pipelines personnalisés."],
          ]}
        />
        <Callout variant="info">
          Si le fichier existe déjà dans le dossier local, l'assistant demande de confirmer son remplacement. Tant que rien n'est commité, <Strong>Restaurer</Strong> dans
          l'éditeur rétablit l'ancienne version.
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
          [<><Kbd>⌘</Kbd> <Kbd>F</Kbd></>, "Rechercher dans le log affiché ou dans l'éditeur."],
          [<><Kbd>⌘</Kbd> <Kbd>S</Kbd></>, "Enregistrer le fichier CI dans le dossier local (éditeur)."],
          [<><Kbd>Ctrl</Kbd> <Kbd>Espace</Kbd></>, "Suggérer les mots-clés de la plateforme (éditeur)."],
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
    summary: "Comptes, dépôts suivis, langue, apparence, synchronisation, notifications, mises à jour.",
    content: (
      <Table
        head={["Section", "Réglages"]}
        rows={[
          ["Comptes", "Un compte par plateforme : connexion, déconnexion, stockage des identifiants, messages en cas d'identifiants expirés."],
          ["Dépôts suivis", "Dépôts ajoutés manuellement et dépôts masqués."],
          ["Projets locaux", "Dossiers de projets, détection des clones, récupération et mise à jour automatiques, éditeur de code."],
          ["Apparence", "Langue de l'interface (système, français ou anglais) et thème clair, sombre ou identique au système."],
          ["Synchronisation", "Fréquence d'actualisation (30 s à 5 min, ou manuelle), affichage des dépôts sans CI et des dépôts archivés."],
          ["Notifications", "Notifications des pipelines en échec ou repassés au vert, dépôts concernés (tous ou favoris), notification d'essai."],
          ["Mises à jour", "Version installée, vérification manuelle ou automatique des nouvelles versions, versions ignorées."],
        ]}
      />
    ),
  },
  {
    id: "updates",
    title: "Installation et mises à jour",
    icon: CircleArrowUp,
    summary: "Installer Easy CI en une commande et être prévenu des nouvelles versions.",
    content: (
      <>
        <P>Easy CI s'installe en une commande sur chaque système. Git reste nécessaire pour les projets locaux.</P>
        <H3>macOS</H3>
        <P>Avec Homebrew (la commande brew trust, demandée à partir de Homebrew 7, approuve ce tap tiers) : mise à jour par brew upgrade, mais clic droit › Ouvrir au premier lancement (Homebrew applique la quarantaine).</P>
        <CodeBlock>{"brew trust --tap rodolphe37/easy-ci && brew tap rodolphe37/easy-ci && brew install --cask easy-ci"}</CodeBlock>
        <P>Ou avec le script d'installation : aucun avertissement Gatekeeper ; relancez-le pour mettre à jour.</P>
        <CodeBlock>{"curl -fsSL https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/macos/install.sh | bash"}</CodeBlock>
        <H3>Linux</H3>
        <P>Installe dans ~/.local/share/easy-ci, avec la commande easy-ci et l'entrée du menu des applications.</P>
        <CodeBlock>{"curl -fsSL https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/linux/install.sh | bash"}</CodeBlock>
        <H3>Windows</H3>
        <P>Dans PowerShell : installe dans le dossier des programmes de l'utilisateur, avec un raccourci dans le menu Démarrer.</P>
        <CodeBlock>{"irm https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/windows/install.ps1 | iex"}</CodeBlock>

        <H3>Être prévenu d'une nouvelle version</H3>
        <P>
          Au démarrage puis toutes les 6 heures, Easy CI demande à GitHub quelle est la dernière version publiée. Si elle est plus récente, une fenêtre affiche
          les nouveautés et la <Strong>commande de mise à jour adaptée à votre installation</Strong> (Homebrew, script ou PowerShell) avec un bouton Copier :
          collez-la dans un terminal puis relancez l'application. Vos comptes et préférences sont conservés.
        </P>
        <Table
          head={["Bouton", "Effet"]}
          rows={[
            ["Plus tard", "Ferme la fenêtre ; le rappel « Mise à jour disponible » reste en bas de la barre latérale."],
            ["Ignorer cette version", "Plus aucun rappel pour cette version ; les suivantes seront signalées. Annulable dans Paramètres › Mises à jour."],
            ["Voir la version", "Ouvre la page de la version sur GitHub (notes complètes, téléchargement manuel)."],
          ]}
        />
        <Callout variant="info">
          La vérification n'envoie aucune donnée personnelle et se désactive dans <Strong>Paramètres › Mises à jour</Strong>, où le bouton <Strong>Vérifier</Strong>{" "}
          permet aussi de lancer une vérification immédiate.
        </Callout>
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "Dépannage",
    icon: CircleHelp,
    summary: "Les problèmes courants et leurs solutions.",
    content: (
      <>
        <Question question="Avertissement de sécurité au premier lancement">
          <P>
            Les versions téléchargées ne sont pas signées. Sur macOS, faites un clic droit sur <Code>EasyCI.app</Code> › <Strong>Ouvrir</Strong> (une seule fois), ou
            lancez <Code>xattr -dr com.apple.quarantine /Applications/EasyCI.app</Code>. Sur Windows, dans la fenêtre SmartScreen : <Strong>Informations
            complémentaires › Exécuter quand même</Strong>.
          </P>
        </Question>
        <Question question="macOS demande deux fois le mot de passe du trousseau au démarrage">
          <P>
            C'est normal : vos identifiants sont rangés dans le trousseau de macOS, et le système vérifie séparément deux autorisations pour la même clé
            (lire son contenu, puis accéder à la clé). Saisissez le mot de passe de votre session macOS et choisissez <Strong>Toujours autoriser</Strong> dans les
            deux fenêtres : elles ne reviennent plus.
          </P>
          <P>
            Easy CI n'étant pas signé par un certificat de développeur Apple, macOS considère chaque nouvelle version comme une autre application : les deux
            fenêtres réapparaissent une fois après chaque mise à jour. Avec « Autoriser » seul, la question revient à chaque lancement.
          </P>
        </Question>
        <Question question="Après une mise à jour, l'interface semble ne pas avoir changé">
          <P>
            Paramètres › Mises à jour indique la nouvelle version mais les nouveautés n'apparaissent pas : le moteur web a gardé l'ancienne interface en cache.
            Corrigé à partir de la version 0.4.1. Pour une version antérieure, quittez Easy CI puis supprimez le cache avant de relancer :
          </P>
          <CodeBlock>{"rm -rf ~/Library/Caches/io.github.rodolphe37.easyci/WebKit/NetworkCache"}</CodeBlock>
        </Question>
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
        <Question question="« Identité Git non configurée » en commitant">
          <P>Git a besoin d'un nom et d'une adresse pour signer les commits. Dans un terminal :</P>
          <CodeBlock>{'git config --global user.name "Votre nom"\ngit config --global user.email vous@exemple.fr'}</CodeBlock>
        </Question>
        <Question question="La création de pull request échoue">
          <P>
            Vérifiez que la branche a bien été envoyée, qu'elle diffère de la branche cible et que le token du compte a le droit de créer des pull requests (voir
            Modifier la CI › Droits nécessaires).
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
          plateformes que vous connectez (<Code>api.github.com</Code>, votre instance GitLab, <Code>api.bitbucket.org</Code>) et, pour la vérification des mises à
          jour, avec l'API publique des versions d'Easy CI sur GitHub (désactivable dans Paramètres › Mises à jour). Aucune télémétrie, aucune IA.
        </P>
        <Table
          head={["Donnée", "Emplacement"]}
          rows={[
            ["Identifiants (tokens, e-mail Bitbucket)", "Trousseau sécurisé du système, une entrée par plateforme."],
            [
              "Préférences (langue, thème, favoris, dépôts ajoutés ou masqués)",
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
