import { Bell, BookOpen, Bug, CheckCircle2, ScrollText, CircleArrowUp, Eye, FolderOpen, GitBranch, TriangleAlert, KeyRound, LogOut, Monitor, Moon, Plus, RefreshCw, ShieldCheck, Sparkles, Sun, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { LanguageSegmented } from "@/components/LanguageSwitcher";
import i18n from "@/i18n";
import { AddRepositoryDialog } from "@/components/AddRepositoryDialog";
import { ConnectAccountForm } from "@/components/ConnectAccountForm";
import { FolderField } from "@/components/local/FolderField";
import { ProviderGuide } from "@/components/docs/DocsContent";
import { Modal, Tooltip } from "@/components/ui/overlays";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Avatar, Badge, BrandIllustration, Button, GitHubMark, buttonClass, Card, SegmentedControl, Switch } from "@/components/ui/primitives";
import { useLocalActions, useLocalProjects } from "@/hooks/local";
import { useRepositoryActions } from "@/hooks/repositories";
import { useNow } from "@/hooks/useNow";
import { useUpdates } from "@/hooks/updates";
import { sendSystemNotification } from "@/hooks/notifications";
import { installMethodLabel } from "@/components/UpdateDialog";
import { useSession, useSessionActions, useSettings } from "@/hooks/session";
import { api } from "@/lib/api";
import { PROVIDER_IDS, PROVIDER_LABELS, ProviderIcon } from "@/lib/providers";
import type { ProviderId, Settings } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { Page } from "./OverviewPage";

const REPOSITORY_URL = "https://github.com/rodolphe37/easy-ci";

const aboutLinks = () => [
  { label: i18n.t("settings.about.source"), url: REPOSITORY_URL, icon: <GitHubMark className="size-3.5" /> },
  { label: i18n.t("settings.about.reportIssue"), url: `${REPOSITORY_URL}/issues/new/choose`, icon: <Bug className="size-3.5" /> },
  { label: i18n.t("settings.about.changelog"), url: `${REPOSITORY_URL}/blob/main/CHANGELOG.md`, icon: <ScrollText className="size-3.5" /> },
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
      <h1 className="text-[22px] font-semibold tracking-tight">{i18n.t("nav.settings")}</h1>
      <p className="mt-1 mb-7 text-[13.5px] text-fg-muted">{i18n.t("settings.intro")}</p>

      <Accounts />

      <TrackedRepositories />

      <LocalProjectsSettings />

      <SettingsGroup title={i18n.t("settings.appearance.title")}>
        <Row title={i18n.t("language.label")} description={i18n.t("language.description")}>
          <LanguageSegmented />
        </Row>
        <Row title={i18n.t("settings.appearance.theme")} description={i18n.t("settings.appearance.themeDescription")}>
          <SegmentedControl<Settings["theme"]>
            value={settings?.theme ?? "system"}
            onChange={(theme) => update({ theme })}
            options={[
              { value: "system", label: <><Monitor />{i18n.t("language.system")}</> },
              { value: "light", label: <><Sun />{i18n.t("settings.appearance.light")}</> },
              { value: "dark", label: <><Moon />{i18n.t("settings.appearance.dark")}</> },
            ]}
          />
        </Row>
      </SettingsGroup>

      <SettingsGroup title={i18n.t("settings.sync.title")}>
        <Row
          title={i18n.t("settings.sync.refresh")}
          description={i18n.t("settings.sync.refreshDescription")}
        >
          <SegmentedControl<number>
            value={settings?.refresh_interval ?? 60}
            onChange={(refresh_interval) => update({ refresh_interval })}
            options={[
              { value: 30, label: "30 s" },
              { value: 60, label: "1 min" },
              { value: 300, label: "5 min" },
              { value: 0, label: i18n.t("settings.sync.manual") },
            ]}
          />
        </Row>
        <Row title={i18n.t("settings.sync.showNoCi")} description={i18n.t("settings.sync.showNoCiDescription")}>
          <Switch
            label={i18n.t("settings.sync.showNoCi")}
            checked={settings?.show_repos_without_ci ?? true}
            onChange={(show_repos_without_ci) => update({ show_repos_without_ci })}
          />
        </Row>
        <Row title={i18n.t("settings.sync.archived")} description={i18n.t("settings.sync.archivedDescription")}>
          <Switch label={i18n.t("settings.sync.archived")} checked={settings?.include_archived ?? false} onChange={(include_archived) => update({ include_archived })} />
        </Row>
      </SettingsGroup>

      <NotificationsSettings />

      <UpdatesSettings />

      <SettingsGroup title={i18n.t("settings.about.title")}>
        <div className="flex items-center gap-5 px-5 py-5">
          <BrandIllustration className="size-24 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[16px] font-semibold tracking-tight">Easy CI</span>
              {session?.app_version ? <Badge>v{session.app_version}</Badge> : null}
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
              {i18n.t("settings.about.description")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {aboutLinks().map((link) => (
                <Button key={link.url} size="sm" variant="secondary" onClick={() => void api.openExternal(link.url)}>
                  {link.icon} {link.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title={i18n.t("settings.shortcuts.title")}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 px-5 py-4 text-[13px]">
          <Shortcut keys={["⌘", "K"]}>{i18n.t("palette.label")}</Shortcut>
          <Shortcut keys={["R"]}>{i18n.t("palette.refreshAll")}</Shortcut>
          <Shortcut keys={["/"]}>{i18n.t("settings.shortcuts.search")}</Shortcut>
          <Shortcut keys={["⌘", "F"]}>{i18n.t("settings.shortcuts.searchLog")}</Shortcut>
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
    <SettingsGroup title={i18n.t("settings.accounts.title")} id="accounts">
      {demo ? (
        <div className="flex items-center gap-4 px-5 py-5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">{i18n.t("settings.accounts.demoTitle")}</div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">
              {i18n.t("settings.accounts.demoDescription")}
            </p>
          </div>
          <Button variant="primary" onClick={() => logout.mutate()} loading={logout.isPending}>
            {i18n.t("settings.accounts.connectMine")}
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
                      <span className="size-1.5 rounded-full bg-success" /> {i18n.t("settings.accounts.connected")}
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
                          ? i18n.t("settings.accounts.keychainTooltip")
                          : i18n.t("settings.accounts.sessionTooltip")
                      }
                    >
                      <span className="inline-flex items-center gap-1 text-fg-subtle">
                        · {account.persisted ? <ShieldCheck className="size-3.5 text-success" /> : <KeyRound className="size-3.5 text-running" />}
                        {account.persisted ? i18n.t("settings.accounts.keychain") : i18n.t("settings.accounts.session")}
                      </span>
                    </Tooltip>
                  </div>
                ) : restoreError ? (
                  <div className="mt-0.5 text-[12.5px] text-running">{restoreError.message}</div>
                ) : (
                  <div className="mt-0.5 text-[12.5px] text-fg-subtle">{info.ci} · {i18n.t("settings.accounts.notConnected")}</div>
                )}
              </div>
              {account ? (
                <Button variant="ghost" onClick={() => disconnect.mutate(provider)} loading={disconnect.isPending && disconnect.variables === provider}>
                  <LogOut /> {i18n.t("settings.accounts.disconnect")}
                </Button>
              ) : (
                <Button variant={restoreError ? "primary" : "secondary"} onClick={() => setConnecting(provider)}>
                  <Plus /> {restoreError ? i18n.t("settings.accounts.reconnect") : i18n.t("settings.accounts.connect")}
                </Button>
              )}
            </div>
          );
        })
      )}

      <Modal
        open={connecting !== null}
        onOpenChange={(open) => !open && setConnecting(null)}
        title={connecting ? i18n.t("connect.guideTitle", { provider: PROVIDER_LABELS[connecting].label }) : ""}
        description={i18n.t("settings.accounts.connectDescription")}
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
        title={guide ? i18n.t("connect.guideTitle", { provider: PROVIDER_LABELS[guide].label }) : ""}
        description={i18n.t("connect.guideDescription")}
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
    <SettingsGroup title={i18n.t("settings.local.title")} id="local">
      <Row
        icon={overview?.git_version ? <GitBranch className="text-accent" /> : <TriangleAlert className="text-failure" />}
        title={overview?.git_version ? `Git ${overview.git_version}` : i18n.t("settings.local.gitMissing")}
        description={
          overview?.git_version
            ? i18n.t("settings.local.gitDescription")
            : i18n.t("settings.local.gitMissingDescription")
        }
      >
        <Link to="/docs?section=local" className={buttonClass("ghost", "sm")}>
          <BookOpen className="size-3.5" /> {i18n.t("settings.learnMore")}
        </Link>
      </Row>

      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-medium">{i18n.t("settings.local.roots")}</div>
            <div className="mt-0.5 text-[12.5px] text-fg-muted">
              {i18n.t("settings.local.rootsDescription")}
            </div>
          </div>
          <Button size="sm" onClick={() => scan.mutate()} loading={scan.isPending} disabled={!overview?.roots.length}>
            <RefreshCw className="size-3.5" /> {i18n.t("settings.local.rescan")}
          </Button>
        </div>

        {overview?.roots.length ? (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {overview.roots.map((root) => (
              <li key={root.path} className="flex items-center gap-3 py-1.5 pr-1.5 pl-3">
                <FolderOpen className="size-3.5 shrink-0 text-fg-subtle" />
                <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{root.display_path}</code>
                {!root.exists ? <Badge className="border-running/30 bg-running/10 text-fg">{i18n.t("settings.local.missing")}</Badge> : null}
                <Button variant="ghost" size="sm" onClick={() => removeRoot.mutate(root.path)} className="text-fg-muted hover:text-failure">
                  <Trash2 className="size-3.5" /> {i18n.t("settings.remove")}
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
              <FolderField value={path} onChange={setPath} pickerAvailable={overview?.picker_available ?? false} pickerTitle={i18n.t("settings.local.pickerTitle")} />
            </div>
            <Button type="submit" variant="primary" className="h-9" loading={addRoot.isPending} disabled={!path.trim()}>
              <Plus /> {i18n.t("settings.add")}
            </Button>
          </div>
        </form>

        {overview?.scanned_at ? (
          <p className="mt-3 text-[12.5px] text-fg-muted">
            <span className="font-medium text-fg">
              {i18n.t("settings.local.linkedProjects", { count: overview.projects.length })}
            </span>{" "}
            {i18n.t("settings.local.toRepositories")}
            {overview.unmatched.length ? (
              <Tooltip
                content={
                  <span>
                    {i18n.t("settings.local.unmatchedTooltip")}
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
                  · {i18n.t("settings.local.unmatched", { count: overview.unmatched.length })}
                </span>
              </Tooltip>
            ) : null}{" "}
            · {i18n.t("settings.local.detected", { time: timeAgo(new Date(overview.scanned_at * 1000).toISOString(), now) })}
          </p>
        ) : null}
      </div>

      <Row title={i18n.t("settings.local.autoFetch")} description={i18n.t("settings.local.autoFetchDescription")}>
        <SegmentedControl<number>
          value={settings?.auto_fetch_minutes ?? 15}
          onChange={(auto_fetch_minutes) => update({ auto_fetch_minutes })}
          options={[
            { value: 0, label: i18n.t("settings.local.off") },
            { value: 5, label: "5 min" },
            { value: 15, label: "15 min" },
            { value: 60, label: "1 h" },
          ]}
        />
      </Row>
      <Row
        title={i18n.t("settings.local.autoPull")}
        description={i18n.t("settings.local.autoPullDescription")}
      >
        <Switch label={i18n.t("settings.local.autoPull")} checked={settings?.auto_pull ?? false} onChange={(auto_pull) => update({ auto_pull })} />
      </Row>
      {editors.length > 1 ? (
        <Row title={i18n.t("settings.local.editor")} description={i18n.t("settings.local.editorDescription")}>
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
    <SettingsGroup title={i18n.t("settings.tracked.title")} id="repositories">
      <Row
        icon={<RefreshCw className="text-accent" />}
        title={i18n.t("settings.tracked.discovery")}
        description={i18n.t("settings.tracked.discoveryDescription")}
      >
        <Link to="/docs?section=repositories" className={buttonClass("ghost", "sm")}>
          <BookOpen className="size-3.5" /> {i18n.t("settings.learnMore")}
        </Link>
      </Row>

      <div className="px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-medium">{i18n.t("settings.tracked.added")}</div>
            <div className="mt-0.5 text-[12.5px] text-fg-muted">{i18n.t("settings.tracked.addedDescription")}</div>
          </div>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> {i18n.t("addRepository.title")}
          </Button>
        </div>
        <RepoList
          names={added}
          empty={i18n.t("settings.tracked.addedEmpty")}
          action={(name) => (
            <Button variant="ghost" size="sm" onClick={() => remove.mutate(name)} className="text-fg-muted hover:text-failure">
              <Trash2 className="size-3.5" /> {i18n.t("settings.remove")}
            </Button>
          )}
        />
      </div>

      <div className="px-5 py-4">
        <div className="text-[13.5px] font-medium">{i18n.t("settings.tracked.hidden")}</div>
        <div className="mt-0.5 text-[12.5px] text-fg-muted">{i18n.t("settings.tracked.hiddenDescription")}</div>
        <RepoList
          names={hidden}
          empty={i18n.t("settings.tracked.hiddenEmpty")}
          action={(name) => (
            <Button variant="ghost" size="sm" onClick={() => unhide(name)}>
              <Eye className="size-3.5" /> {i18n.t("settings.tracked.unhide")}
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

function NotificationsSettings() {
  const { settings, update } = useSettings();
  const [testing, setTesting] = useState(false);
  const support = useQuery({ queryKey: ["notification-support"], queryFn: api.notificationSupport, staleTime: Infinity });
  const enabled = settings?.notifications_enabled ?? true;
  const method = support.data?.method;

  const test = async () => {
    setTesting(true);
    // Navigateur (développement, démo en ligne) : l'autorisation web se demande sur un geste de l'utilisateur.
    if (support.data && !support.data.supported && typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => undefined);
    }
    const result = await sendSystemNotification(i18n.t("notifications.test.title"), i18n.t("notifications.test.body"));
    setTesting(false);
    if (result.delivered) toast.success(i18n.t("settings.notifications.sent"));
    else if (result.reason === "unsupported") toast(i18n.t("settings.notifications.unsupported"), { description: i18n.t("settings.notifications.unsupportedDescription") });
    else toast.error(i18n.t("settings.notifications.failed"), { description: result.error ?? undefined });
  };

  return (
    <SettingsGroup title={i18n.t("settings.notifications.title")} id="notifications">
      <Row
        icon={<Bell className="text-fg-subtle" />}
        title={i18n.t("settings.notifications.enabled")}
        description={`${i18n.t("settings.notifications.enabledDescription")}${method ? ` ${i18n.t(`settings.notifications.method.${method}`)}.` : ""}`}
      >
        <Switch label={i18n.t("settings.notifications.enabled")} checked={enabled} onChange={(notifications_enabled) => update({ notifications_enabled })} />
      </Row>
      {enabled ? (
        <>
          <Row title={i18n.t("settings.notifications.failures")} description={i18n.t("settings.notifications.failuresDescription")}>
            <Switch label={i18n.t("settings.notifications.failures")} checked={settings?.notify_failures ?? true} onChange={(notify_failures) => update({ notify_failures })} />
          </Row>
          <Row title={i18n.t("settings.notifications.recoveries")} description={i18n.t("settings.notifications.recoveriesDescription")}>
            <Switch label={i18n.t("settings.notifications.recoveries")} checked={settings?.notify_recoveries ?? true} onChange={(notify_recoveries) => update({ notify_recoveries })} />
          </Row>
          <Row title={i18n.t("settings.notifications.scope")} description={i18n.t("settings.notifications.scopeDescription")}>
            <SegmentedControl<Settings["notifications_scope"]>
              value={settings?.notifications_scope ?? "all"}
              onChange={(notifications_scope) => update({ notifications_scope })}
              options={[
                { value: "all", label: i18n.t("settings.notifications.all") },
                { value: "favorites", label: i18n.t("settings.notifications.favorites"), count: settings?.favorites.length },
              ]}
            />
          </Row>
          <Row title={i18n.t("settings.notifications.testTitle")} description={`${i18n.t("settings.notifications.testDescription")} ${i18n.t("settings.notifications.background")}`}>
            <Button size="sm" loading={testing} onClick={() => void test()}>
              <Bell className="size-3.5" /> {i18n.t("settings.notifications.test")}
            </Button>
          </Row>
        </>
      ) : null}
    </SettingsGroup>
  );
}

function UpdatesSettings() {
  const { settings, update } = useSettings();
  const { check, pending, checking, checkNow, showDialog } = useUpdates();
  const [justChecked, setJustChecked] = useState(false);
  const now = useNow();

  const status = !check ? (
    <span className="text-fg-subtle">{i18n.t("settings.updates.notChecked")}</span>
  ) : check.available && check.latest ? (
    <span className="inline-flex items-center gap-1.5 text-fg">
      <CircleArrowUp className="size-3.5 text-accent" /> {i18n.t("settings.updates.available", { version: check.latest.version })}
    </span>
  ) : check.error ? (
    <span className="inline-flex items-center gap-1.5 text-fg-muted">
      <TriangleAlert className="size-3.5 text-running" /> {check.error}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-fg-muted">
      <CheckCircle2 className="size-3.5 text-success" /> {i18n.t("settings.updates.upToDate")}
    </span>
  );

  return (
    <SettingsGroup title={i18n.t("settings.updates.title")} id="updates">
      <Row
        title={i18n.t("settings.updates.version", { version: check?.current_version ?? "" }).trim()}
        description={check ? `${installMethodLabel(check.install_method).replace(/^./, (c) => c.toUpperCase())} · ${i18n.t("settings.updates.checked", { time: timeAgo(new Date(check.checked_at * 1000).toISOString(), now) })}` : undefined}
      >
        <div className="flex items-center gap-3 text-[12.5px]">
          {justChecked || check ? status : null}
          {pending ? (
            <Button size="sm" variant="primary" onClick={showDialog}>
              {i18n.t("settings.updates.update")}
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
              <RefreshCw className="size-3.5" /> {i18n.t("settings.updates.check")}
            </Button>
          )}
        </div>
      </Row>
      <Row
        title={i18n.t("settings.updates.auto")}
        description={i18n.t("settings.updates.autoDescription")}
      >
        <Switch checked={settings?.check_updates ?? true} onChange={(check_updates) => update({ check_updates })} label={i18n.t("settings.updates.auto")} />
      </Row>
      {settings?.dismissed_update_version ? (
        <Row title={i18n.t("settings.updates.skipped", { version: settings.dismissed_update_version })} description={i18n.t("settings.updates.skippedDescription")}>
          <Button size="sm" variant="ghost" onClick={() => update({ dismissed_update_version: null })}>
            {i18n.t("settings.updates.unskip")}
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
