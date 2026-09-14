import { BookOpen, Eye, KeyRound, LogOut, Monitor, Moon, Plus, RefreshCw, ShieldCheck, Sparkles, Sun, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { AddRepositoryDialog } from "@/components/AddRepositoryDialog";
import { ConnectAccountForm } from "@/components/ConnectAccountForm";
import { ProviderGuide } from "@/components/docs/DocsContent";
import { Modal, Tooltip } from "@/components/ui/overlays";
import { Avatar, Badge, BrandIllustration, Button, buttonClass, Card, SegmentedControl, Switch } from "@/components/ui/primitives";
import { useRepositoryActions } from "@/hooks/repositories";
import { useSession, useSessionActions, useSettings } from "@/hooks/session";
import { PROVIDER_IDS, PROVIDER_LABELS, ProviderIcon } from "@/lib/providers";
import type { ProviderId, Settings } from "@/lib/types";
import { Page } from "./OverviewPage";

export function SettingsPage() {
  const { data: session } = useSession();
  const { settings, update } = useSettings();

  return (
    <Page className="max-w-3xl">
      <h1 className="text-[22px] font-semibold tracking-tight">Paramètres</h1>
      <p className="mt-1 mb-7 text-[13.5px] text-fg-muted">Personnalisez Easy CI et gérez vos comptes GitHub, GitLab et Bitbucket.</p>

      <Accounts />

      <TrackedRepositories />

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

      <SettingsGroup title="À propos">
        <div className="flex items-center gap-5 px-5 py-5">
          <BrandIllustration className="size-24 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[16px] font-semibold tracking-tight">Easy CI</span>
              {session?.app_version ? <Badge>v{session.app_version}</Badge> : null}
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
              Supervisez et diagnostiquez vos pipelines GitHub Actions, GitLab CI/CD et Bitbucket Pipelines depuis une seule application.
            </p>
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

function TrackedRepositories() {
  const { settings } = useSettings();
  const { remove, unhide } = useRepositoryActions();
  const [adding, setAdding] = useState(false);
  const location = useLocation();
  const added = settings?.added_repositories ?? [];
  const hidden = settings?.hidden_repositories ?? [];

  // Lien direct depuis la page Dépôts (« Gérer les dépôts masqués »).
  useEffect(() => {
    if (location.hash === "#repositories") document.getElementById("repositories")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

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
