import { BookOpen, Bug, CheckCircle2, ScrollText, CircleArrowUp, Eye, FolderOpen, GitBranch, TriangleAlert, KeyRound, LogOut, Monitor, Moon, Plus, RefreshCw, ShieldCheck, Sparkles, Sun, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { AddRepositoryDialog } from "@/components/AddRepositoryDialog";
import { ConnectAccountForm } from "@/components/ConnectAccountForm";
import { FolderField } from "@/components/local/FolderField";
import { ProviderGuide } from "@/components/docs/DocsContent";
import { Modal, Tooltip } from "@/components/ui/overlays";
import { Avatar, Badge, BrandIllustration, Button, GitHubMark, buttonClass, Card, SegmentedControl, Switch } from "@/components/ui/primitives";
import { useLocalActions, useLocalProjects } from "@/hooks/local";
import { useRepositoryActions } from "@/hooks/repositories";
import { useNow } from "@/hooks/useNow";
import { useUpdates } from "@/hooks/updates";
import { INSTALL_METHOD_LABELS } from "@/components/UpdateDialog";
import { useSession, useSessionActions, useSettings } from "@/hooks/session";
import { api } from "@/lib/api";
import { PROVIDER_IDS, PROVIDER_LABELS, ProviderIcon } from "@/lib/providers";
import type { ProviderId, Settings } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { Page } from "./OverviewPage";

const REPOSITORY_URL = "https://github.com/rodolphe37/easy-ci";

const ABOUT_LINKS = [
  { label: "Code source", url: REPOSITORY_URL, icon: <GitHubMark className="size-3.5" /> },
  { label: "Signaler un problème", url: `${REPOSITORY_URL}/issues/new/choose`, icon: <Bug className="size-3.5" /> },
  { label: "Nouveautés", url: `${REPOSITORY_URL}/blob/main/CHANGELOG.md`, icon: <ScrollText className="size-3.5" /> },
];

export function SettingsPage() {
  const { data: session } = useSession();
  const { settings, update } = useSettings();
  const location = useLocation();

  // Liens directs vers une section (« Gérer les dépôts masqués », « Gérer les dossiers »…).
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [location.hash]);

  return (
    <Page className="max-w-3xl">
      <h1 className="text-[22px] font-semibold tracking-tight">Paramètres</h1>
      <p className="mt-1 mb-7 text-[13.5px] text-fg-muted">Personnalisez Easy CI et gérez vos comptes GitHub, GitLab et Bitbucket.</p>

      <Accounts />

      <TrackedRepositories />

      <LocalProjectsSettings />

      <SettingsGroup title="Apparence">
        <Row title="Thème" description="Suivre le système ou forcer un thème clair ou sombre.">
          <SegmentedControl<Settings["theme"]>
            value={settings?.theme ?? "system"}
            onChange={(theme) => update({ theme })}
            options={[
              { value: "system", label: <><Monitor />Système</> },
              { value: "light", label: <><Sun />Clair</> },
              { value: "dark", label: <><Moon />Sombre</> },
            ]}
          />
        </Row>
      </SettingsGroup>

      <SettingsGroup title="Synchronisation">
        <Row
          title="Actualisation automatique"
          description="Fréquence de vérification des dépôts. Les exécutions en cours sont toujours suivies toutes les quelques secondes."
        >
          <SegmentedControl<number>
            value={settings?.refresh_interval ?? 60}
            onChange={(refresh_interval) => update({ refresh_interval })}
            options={[
              { value: 30, label: "30 s" },
              { value: 60, label: "1 min" },
              { value: 300, label: "5 min" },
              { value: 0, label: "Manuelle" },
            ]}
          />
        </Row>
        <Row title="Afficher les dépôts sans CI" description="Les dépôts sans workflow restent visibles, en fin de liste.">
          <Switch
            label="Afficher les dépôts sans CI"
            checked={settings?.show_repos_without_ci ?? true}
            onChange={(show_repos_without_ci) => update({ show_repos_without_ci })}
          />
        </Row>
        <Row title="Inclure les dépôts archivés" description="Les dépôts archivés ne peuvent plus exécuter de workflows.">
          <Switch label="Inclure les dépôts archivés" checked={settings?.include_archived ?? false} onChange={(include_archived) => update({ include_archived })} />
        </Row>
      </SettingsGroup>

      <UpdatesSettings />

      <SettingsGroup title="À propos">
        <div className="flex items-center gap-5 px-5 py-5">
          <BrandIllustration className="size-24 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[16px] font-semibold tracking-tight">Easy CI</span>
              {session?.app_version ? <Badge>v{session.app_version}</Badge> : null}
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
              Supervisez, corrigez, modifiez et générez vos pipelines GitHub Actions, GitLab CI/CD et Bitbucket Pipelines depuis une seule application. Logiciel libre
              distribué sous licence MIT.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {ABOUT_LINKS.map((link) => (
                <Button key={link.url} size="sm" variant="secondary" onClick={() => void api.openExternal(link.url)}>
                  {link.icon} {link.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Raccourcis clavier">
        <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 px-5 py-4 text-[13px]">
          <Shortcut keys={["⌘", "K"]}>Palette de commandes</Shortcut>
          <Shortcut keys={["R"]}>Tout actualiser</Shortcut>
          <Shortcut keys={["/"]}>Rechercher</Shortcut>
          <Shortcut keys={["⌘", "F"]}>Rechercher dans un log</Shortcut>
        </div>
      </SettingsGroup>
    </Page>
  );
}

function Accounts() {
  const { data: session } = useSession();
  const { disconnect, logout } = useSessionActions();
  const [connecting, setConnecting] = useState<ProviderId | null>(null);
  const [guide, setGuide] = useState<ProviderId | null>(null);
  const demo = session?.mode === "demo";

  return (
    <SettingsGroup title="Comptes" id="accounts">
      {demo ? (
        <div className="flex items-center gap-4 px-5 py-5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">Vous explorez le mode démo</div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">
              Les dépôts affichés sont fictifs. Quittez la démo pour connecter vos comptes GitHub, GitLab ou Bitbucket.
            </p>
          </div>
          <Button variant="primary" onClick={() => logout.mutate()} loading={logout.isPending}>
            Connecter mes comptes
          </Button>
        </div>
      ) : (
        PROVIDER_IDS.map((provider) => {
          const account = session?.accounts.find((a) => a.provider === provider);
          const restoreError = session?.restore_errors.find((e) => e.provider === provider);
          const info = PROVIDER_LABELS[provider];
          const host = account?.host.replace(/^https?:\/\//, "");
          return (
            <div key={provider} className="flex items-center gap-3.5 px-5 py-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2">
                <ProviderIcon provider={provider} className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                  {info.label}
                  {account ? (
                    <Badge className="border-success/25 bg-success/10 text-fg">
                      <span className="size-1.5 rounded-full bg-success" /> Connecté
                    </Badge>
                  ) : null}
                </div>
                {account ? (
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[12.5px] text-fg-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar login={account.user.login} src={account.user.avatar_url} size={16} />
                      {account.user.name} <span className="text-fg-subtle">@{account.user.login}</span>
                    </span>
                    {provider === "gitlab" ? <span className="text-fg-subtle">· {host}</span> : null}
                    <Tooltip
                      content={
                        account.persisted
                          ? "Enregistré dans le trousseau sécurisé du système : vous restez connecté entre deux lancements."
                          : "Trousseau indisponible : identifiants conservés pour cette session seulement."
                      }
                    >
                      <span className="inline-flex items-center gap-1 text-fg-subtle">
                        · {account.persisted ? <ShieldCheck className="size-3.5 text-success" /> : <KeyRound className="size-3.5 text-running" />}
                        {account.persisted ? "Trousseau" : "Session"}
                      </span>
                    </Tooltip>
                  </div>
                ) : restoreError ? (
                  <div className="mt-0.5 text-[12.5px] text-running">{restoreError.message}</div>
                ) : (
                  <div className="mt-0.5 text-[12.5px] text-fg-subtle">{info.ci} · non connecté</div>
                )}
              </div>
              {account ? (
                <Button variant="ghost" onClick={() => disconnect.mutate(provider)} loading={disconnect.isPending && disconnect.variables === provider}>
                  <LogOut /> Déconnecter
                </Button>
              ) : (
                <Button variant={restoreError ? "primary" : "secondary"} onClick={() => setConnecting(provider)}>
                  <Plus /> {restoreError ? "Reconnecter" : "Connecter"}
                </Button>
              )}
            </div>
          );
        })
      )}

      <Modal
        open={connecting !== null}
        onOpenChange={(open) => !open && setConnecting(null)}
        title={connecting ? `Connecter ${PROVIDER_LABELS[connecting].label}` : ""}
        description="Les identifiants sont vérifiés auprès de la plateforme puis enregistrés dans le trousseau du système."
      >
        <div className="px-5 py-5">
          {connecting ? (
            <ConnectAccountForm
              key={connecting}
              initialProvider={connecting}
              lockProvider
              onConnected={() => setConnecting(null)}
              onOpenGuide={(provider) => {
                setConnecting(null);
                setGuide(provider);
              }}
            />
          ) : null}
        </div>
      </Modal>
      <Modal
        open={guide !== null}
        onOpenChange={(open) => !open && setGuide(null)}
        title={guide ? `Connecter ${PROVIDER_LABELS[guide].label}` : ""}
        description="Créer un token, choisir les droits et se connecter."
        className="w-[min(760px,calc(100vw-48px))]"
      >
        <div className="scrollbar-thin max-h-[min(640px,72vh)] overflow-y-auto px-6 pb-6">{guide ? <ProviderGuide provider={guide} /> : null}</div>
      </Modal>
    </SettingsGroup>
  );
}

function LocalProjectsSettings() {
  const { overview, scan } = useLocalProjects();
  const { addRoot, removeRoot } = useLocalActions();
  const { settings, update } = useSettings();
  const [path, setPath] = useState("");
  const now = useNow();
  const editors = overview?.editors ?? [];

  return (
    <SettingsGroup title="Projets locaux" id="local">
      <Row
        icon={overview?.git_version ? <GitBranch className="text-accent" /> : <TriangleAlert className="text-failure" />}
        title={overview?.git_version ? `Git ${overview.git_version}` : "Git introuvable"}
        description={
          overview?.git_version
            ? "Easy CI utilise le Git installé sur votre machine, avec vos identifiants et votre configuration habituels."
            : "Installez Git (https://git-scm.com) puis relancez Easy CI pour utiliser les projets locaux."
        }
      >
        <Link to="/docs?section=local" className={buttonClass("ghost", "sm")}>
          <BookOpen className="size-3.5" /> En savoir plus
        </Link>
      </Row>

      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-medium">Dossiers de projets</div>
            <div className="mt-0.5 text-[12.5px] text-fg-muted">
              Easy CI y recherche vos clones Git (jusqu'à 6 niveaux, hors node_modules, .venv…) et les relie à vos dépôts.
            </div>
          </div>
          <Button size="sm" onClick={() => scan.mutate()} loading={scan.isPending} disabled={!overview?.roots.length}>
            <RefreshCw className="size-3.5" /> Relancer la détection
          </Button>
        </div>

        {overview?.roots.length ? (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {overview.roots.map((root) => (
              <li key={root.path} className="flex items-center gap-3 py-1.5 pr-1.5 pl-3">
                <FolderOpen className="size-3.5 shrink-0 text-fg-subtle" />
                <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{root.display_path}</code>
                {!root.exists ? <Badge className="border-running/30 bg-running/10 text-fg">introuvable</Badge> : null}
                <Button variant="ghost" size="sm" onClick={() => removeRoot.mutate(root.path)} className="text-fg-muted hover:text-failure">
                  <Trash2 className="size-3.5" /> Retirer
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (path.trim()) addRoot.mutate(path.trim(), { onSuccess: () => setPath("") });
          }}
        >
          <div className="flex gap-2">
            <div className="flex-1">
              <FolderField value={path} onChange={setPath} pickerAvailable={overview?.picker_available ?? false} pickerTitle="Dossier contenant vos projets" />
            </div>
            <Button type="submit" variant="primary" className="h-9" loading={addRoot.isPending} disabled={!path.trim()}>
              <Plus /> Ajouter
            </Button>
          </div>
        </form>

        {overview?.scanned_at ? (
          <p className="mt-3 text-[12.5px] text-fg-muted">
            <span className="font-medium text-fg">
              {overview.projects.length} projet{overview.projects.length > 1 ? "s" : ""} relié{overview.projects.length > 1 ? "s" : ""}
            </span>{" "}
            à vos dépôts
            {overview.unmatched.length ? (
              <Tooltip
                content={
                  <span>
                    Clones dont aucun remote ne correspond à un dépôt suivi :
                    <br />
                    {overview.unmatched.slice(0, 8).map((item) => (
                      <span key={item.path} className="block font-mono text-[11px]">
                        {item.display_path}
                      </span>
                    ))}
                  </span>
                }
              >
                <span className="cursor-help underline decoration-dotted underline-offset-2">
                  {" "}
                  · {overview.unmatched.length} autre{overview.unmatched.length > 1 ? "s" : ""} non reconnu{overview.unmatched.length > 1 ? "s" : ""}
                </span>
              </Tooltip>
            ) : null}{" "}
            · détection {timeAgo(new Date(overview.scanned_at * 1000).toISOString(), now)}
          </p>
        ) : null}
      </div>

      <Row title="Récupération automatique" description="Interroge régulièrement le serveur Git de chaque projet lié (git fetch), sans toucher à vos fichiers.">
        <SegmentedControl<number>
          value={settings?.auto_fetch_minutes ?? 15}
          onChange={(auto_fetch_minutes) => update({ auto_fetch_minutes })}
          options={[
            { value: 0, label: "Désactivée" },
            { value: 5, label: "5 min" },
            { value: 15, label: "15 min" },
            { value: 60, label: "1 h" },
          ]}
        />
      </Row>
      <Row
        title="Mettre à jour les branches automatiquement"
        description="Après chaque récupération, avance la branche locale si elle est en retard. Jamais en cas de modifications non commitées ou de commits locaux non poussés."
      >
        <Switch label="Mise à jour automatique" checked={settings?.auto_pull ?? false} onChange={(auto_pull) => update({ auto_pull })} />
      </Row>
      {editors.length > 1 ? (
        <Row title="Éditeur de code" description="Utilisé par « Ouvrir dans l'éditeur ».">
          <SegmentedControl<string>
            value={settings?.preferred_editor ?? editors[0].id}
            onChange={(preferred_editor) => update({ preferred_editor })}
            options={editors.map((editor) => ({ value: editor.id, label: editor.label }))}
          />
        </Row>
      ) : null}
    </SettingsGroup>
  );
}

function TrackedRepositories() {
  const { settings } = useSettings();
  const { remove, unhide } = useRepositoryActions();
  const [adding, setAdding] = useState(false);
  const added = settings?.added_repositories ?? [];
  const hidden = settings?.hidden_repositories ?? [];


  return (
    <SettingsGroup title="Dépôts suivis" id="repositories">
      <Row
        icon={<RefreshCw className="text-accent" />}
        title="Découverte automatique"
        description="Easy CI suit tous les dépôts accessibles avec vos comptes : les vôtres, ceux de vos organisations, groupes et workspaces. Un dépôt manquant ? Vérifiez les droits du token de la plateforme."
      >
        <Link to="/docs?section=repositories" className={buttonClass("ghost", "sm")}>
          <BookOpen className="size-3.5" /> En savoir plus
        </Link>
      </Row>

      <div className="px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-medium">Ajoutés manuellement</div>
            <div className="mt-0.5 text-[12.5px] text-fg-muted">Dépôts suivis en plus de la découverte automatique.</div>
          </div>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Ajouter un dépôt
          </Button>
        </div>
        <RepoList
          names={added}
          empty="Aucun dépôt ajouté manuellement."
          action={(name) => (
            <Button variant="ghost" size="sm" onClick={() => remove.mutate(name)} className="text-fg-muted hover:text-failure">
              <Trash2 className="size-3.5" /> Retirer
            </Button>
          )}
        />
      </div>

      <div className="px-5 py-4">
        <div className="text-[13.5px] font-medium">Masqués</div>
        <div className="mt-0.5 text-[12.5px] text-fg-muted">Dépôts découverts automatiquement que vous avez choisi de ne pas afficher.</div>
        <RepoList
          names={hidden}
          empty="Aucun dépôt masqué. Utilisez le menu « ⋯ » d'un dépôt pour le masquer."
          action={(name) => (
            <Button variant="ghost" size="sm" onClick={() => unhide(name)}>
              <Eye className="size-3.5" /> Réafficher
            </Button>
          )}
        />
      </div>

      <AddRepositoryDialog open={adding} onOpenChange={setAdding} />
    </SettingsGroup>
  );
}

function RepoList({ names, empty, action }: { names: string[]; empty: string; action: (name: string) => ReactNode }) {
  if (names.length === 0) return <p className="mt-3 text-[12.5px] text-fg-subtle">{empty}</p>;
  return (
    <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
      {names.map((name) => (
        <li key={name} className="flex items-center gap-3 py-1.5 pr-1.5 pl-3">
          <ProviderIcon provider={providerOfKey(name)} className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{name.slice(name.indexOf(":") + 1)}</span>
          {action(name)}
        </li>
      ))}
    </ul>
  );
}

function UpdatesSettings() {
  const { settings, update } = useSettings();
  const { check, pending, checking, checkNow, showDialog } = useUpdates();
  const [justChecked, setJustChecked] = useState(false);
  const now = useNow();

  const status = !check ? (
    <span className="text-fg-subtle">Pas encore vérifié</span>
  ) : check.available && check.latest ? (
    <span className="inline-flex items-center gap-1.5 text-fg">
      <CircleArrowUp className="size-3.5 text-accent" /> Easy CI {check.latest.version} est disponible
    </span>
  ) : check.error ? (
    <span className="inline-flex items-center gap-1.5 text-fg-muted">
      <TriangleAlert className="size-3.5 text-running" /> {check.error}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-fg-muted">
      <CheckCircle2 className="size-3.5 text-success" /> Vous utilisez la dernière version
    </span>
  );

  return (
    <SettingsGroup title="Mises à jour" id="updates">
      <Row
        title={`Version ${check?.current_version ?? ""}`.trim()}
        description={check ? `${INSTALL_METHOD_LABELS[check.install_method].replace(/^./, (c) => c.toUpperCase())} · vérifié ${timeAgo(new Date(check.checked_at * 1000).toISOString(), now)}` : undefined}
      >
        <div className="flex items-center gap-3 text-[12.5px]">
          {justChecked || check ? status : null}
          {pending ? (
            <Button size="sm" variant="primary" onClick={showDialog}>
              Mettre à jour…
            </Button>
          ) : (
            <Button
              size="sm"
              loading={checking}
              onClick={() =>
                void checkNow()
                  .then(() => setJustChecked(true))
                  .catch(() => undefined)
              }
            >
              <RefreshCw className="size-3.5" /> Vérifier
            </Button>
          )}
        </div>
      </Row>
      <Row
        title="Rechercher les mises à jour automatiquement"
        description="Interroge GitHub au démarrage puis toutes les 6 heures pour savoir si une version plus récente est publiée. Aucune donnée personnelle n'est envoyée."
      >
        <Switch checked={settings?.check_updates ?? true} onChange={(check_updates) => update({ check_updates })} label="Rechercher les mises à jour" />
      </Row>
      {settings?.dismissed_update_version ? (
        <Row title={`Version ${settings.dismissed_update_version} ignorée`} description="Aucune fenêtre ne s'affiche pour cette version. Les versions suivantes seront signalées.">
          <Button size="sm" variant="ghost" onClick={() => update({ dismissed_update_version: null })}>
            Ne plus ignorer
          </Button>
        </Row>
      ) : null}
    </SettingsGroup>
  );
}

function SettingsGroup({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="mb-6 scroll-mt-6" id={id}>
      <h2 className="mb-2 px-1 text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">{title}</h2>
      <Card className="divide-y divide-line">{children}</Card>
    </section>
  );
}

function Row({ icon, title, description, children }: { icon?: ReactNode; title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      {icon ? <div className="[&_svg]:size-5">{icon}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        {description ? <div className="mt-0.5 text-[12.5px] text-fg-muted">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Shortcut({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-fg-muted">{children}</span>
      <span className="flex gap-1">
        {keys.map((key) => (
          <kbd key={key} className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line-strong bg-surface-2 px-1.5 text-[11.5px] font-medium">
            {key}
          </kbd>
        ))}
      </span>
    </div>
  );
}

function providerOfKey(key: string): ProviderId {
  const provider = key.slice(0, key.indexOf(":"));
  return provider === "gitlab" || provider === "bitbucket" ? provider : "github";
}
