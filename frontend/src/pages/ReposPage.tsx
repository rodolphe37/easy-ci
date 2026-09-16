import { Archive, Laptop, BookOpen, EyeOff, ExternalLink, FolderGit2, GitFork, Lock, MoreHorizontal, Plus, Search, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { AddRepositoryDialog } from "@/components/AddRepositoryDialog";
import { TimeAgo } from "@/components/runs";
import { HistoryStrip, StatusIcon, stateLabel } from "@/components/status";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from "@/components/ui/overlays";
import { Badge, Button, buttonClass, Card, EmptyState, Input, Kbd, SegmentedControl, Skeleton } from "@/components/ui/primitives";
import { useLocalProjects } from "@/hooks/local";
import { useRepositoryActions } from "@/hooks/repositories";
import { useScans, type RepoEntry } from "@/hooks/scans";
import { useSettings } from "@/hooks/session";
import { api } from "@/lib/api";
import { PROVIDER_IDS, PROVIDER_LABELS, ProviderIcon, repoPath } from "@/lib/providers";
import type { ProviderId, Repository } from "@/lib/types";
import { cn, timeKey } from "@/lib/utils";
import { ListSkeleton, Page } from "./OverviewPage";

type Filter = "all" | "failure" | "running" | "success" | "favorites" | "none";

const SEVERITY = ["failure", "running", "queued", "action_required", "cancelled", "success", "neutral", "skipped", "none"];

export function ReposPage() {
  const { t } = useTranslation();
  const { entries: allEntries, isLoadingRepos, reposErrors, accounts } = useScans();
  const { settings, isFavorite } = useSettings();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [providerFilter, setProviderFilter] = useState<ProviderId | "all">("all");
  const entries = useMemo(
    () => (providerFilter === "all" ? allEntries : allEntries.filter((entry) => entry.repo.provider === providerFilter)),
    [allEntries, providerFilter],
  );
  const [sort, setSort] = useState<"activity" | "status" | "name">("activity");
  const [adding, setAdding] = useState(false);
  const hiddenCount = settings?.hidden_repositories?.length ?? 0;

  const counts = useMemo(
    () => ({
      all: entries.length,
      failure: entries.filter((e) => e.scan?.state === "failure").length,
      running: entries.filter((e) => e.scan?.state === "running" || e.scan?.state === "queued").length,
      success: entries.filter((e) => e.scan?.state === "success").length,
      favorites: entries.filter((e) => isFavorite(e.repo.key)).length,
      none: entries.filter((e) => e.scan && !e.scan.has_ci).length,
    }),
    [entries, isFavorite],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      const state = entry.scan?.state;
      if (q && !`${entry.repo.full_name} ${entry.repo.description ?? ""}`.toLowerCase().includes(q)) return false;
      switch (filter) {
        case "failure":
          return state === "failure";
        case "running":
          return state === "running" || state === "queued";
        case "success":
          return state === "success";
        case "favorites":
          return isFavorite(entry.repo.key);
        case "none":
          return entry.scan !== undefined && !entry.scan.has_ci;
        default:
          return settings?.show_repos_without_ci !== false || !entry.scan || entry.scan.has_ci;
      }
    });
    const activity = (e: RepoEntry) => e.scan?.last_run?.created_at ?? e.repo.pushed_at ?? "";
    return filtered.sort((a, b) => {
      // Dépôts avec CI toujours avant les autres, favoris en tête.
      const ci = Number(b.scan?.has_ci ?? true) - Number(a.scan?.has_ci ?? true);
      if (ci) return ci;
      const fav = Number(isFavorite(b.repo.key)) - Number(isFavorite(a.repo.key));
      if (fav) return fav;
      if (sort === "name") return a.repo.full_name.localeCompare(b.repo.full_name);
      if (sort === "status") {
        const diff = SEVERITY.indexOf(a.scan?.state ?? "none") - SEVERITY.indexOf(b.scan?.state ?? "none");
        if (diff) return diff;
      }
      return activity(b).localeCompare(activity(a));
    });
  }, [entries, query, filter, sort, isFavorite, settings?.show_repos_without_ci]);

  return (
    <Page>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{t("nav.repositories")}</h1>
          <p className="mt-1 text-[13.5px] text-fg-muted">
            {t("repos.intro")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/docs?section=repositories" className={buttonClass("ghost")}>
            <BookOpen /> {t("repos.howItWorks")}
          </Link>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus /> {t("addRepository.title")}
          </Button>
        </div>
      </div>
      <AddRepositoryDialog open={adding} onOpenChange={setAdding} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          icon={<Search />}
          placeholder={t("repos.filterPlaceholder")}
          data-page-search
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-72"
          trailing={query ? null : <Kbd>/</Kbd>}
        />
        <SegmentedControl<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("repos.filters.all"), count: counts.all },
            { value: "failure", label: <><StatusIcon state="failure" />{t("repos.filters.failure")}</>, count: counts.failure },
            { value: "running", label: <><StatusIcon state="running" />{t("repos.filters.running")}</>, count: counts.running },
            { value: "success", label: <><StatusIcon state="success" />{t("repos.filters.success")}</>, count: counts.success },
            { value: "favorites", label: <><Star />{t("shell.favorites")}</>, count: counts.favorites },
            { value: "none", label: t("repos.filters.none"), count: counts.none },
          ]}
        />
        {accounts.length > 1 ? (
          <SegmentedControl<ProviderId | "all">
            value={providerFilter}
            onChange={setProviderFilter}
            options={[
              { value: "all", label: t("repos.allPlatforms") },
              ...PROVIDER_IDS.filter((p) => accounts.some((a) => a.provider === p)).map((p) => ({
                value: p,
                label: (
                  <>
                    <ProviderIcon provider={p} />
                    {PROVIDER_LABELS[p].label}
                  </>
                ),
                count: allEntries.filter((e) => e.repo.provider === p).length,
              })),
            ]}
          />
        ) : null}
        <div className="ml-auto flex items-center gap-2 text-[12.5px] text-fg-muted">
          {t("repos.sortBy")}
          <SegmentedControl
            value={sort}
            onChange={setSort}
            options={[
              { value: "activity", label: t("repos.sort.activity") },
              { value: "status", label: t("repos.sort.status") },
              { value: "name", label: t("repos.sort.name") },
            ]}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {isLoadingRepos ? (
          <ListSkeleton rows={6} />
        ) : reposErrors.length && reposErrors.length === accounts.length ? (
          <EmptyState
            icon={<FolderGit2 />}
            title={t("overview.loadFailed")}
            description={reposErrors.map((e) => `${PROVIDER_LABELS[e.provider].label} : ${e.error.message}`).join(" · ")}
          />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<FolderGit2 />}
            title={t("repos.noneAccessible")}
            description={t("repos.noneAccessibleDescription")}
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus /> {t("addRepository.title")}
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title={t("repos.noMatch")}
            description={query ? t("repos.noMatchQuery", { query }) : t("repos.noMatchFilter")}
          />
        ) : (
          <div className="divide-y divide-line">
            {visible.map((entry) => (
              <RepoRow key={entry.repo.key} entry={entry} />
            ))}
          </div>
        )}
      </Card>

      {hiddenCount ? (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[12.5px] text-fg-subtle">
          <EyeOff className="size-3.5" />
          {t("repos.hiddenCount", { count: hiddenCount })} ·
          <Link to="/settings#repositories" className="font-medium text-fg-muted hover:text-accent">
            {t("repos.manage")}
          </Link>
        </p>
      ) : null}
    </Page>
  );
}

function RepoRow({ entry }: { entry: RepoEntry }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite } = useSettings();
  const { hide, remove } = useRepositoryActions();
  const localProject = useLocalProjects().byKey.get(entry.repo.key);
  const { repo, scan, loading, error } = entry;
  const favorite = isFavorite(repo.key);
  const path = repoPath(repo.provider, repo.full_name);
  const noCi = scan && !scan.has_ci;
  const workflows = (scan?.workflows ?? []).filter((wf) => !wf.dynamic || wf.latest_run);
  const mainHistory = [...(scan?.workflows ?? [])]
    .flatMap((wf) => wf.history)
    .sort((a, b) => timeKey(a.created_at) - timeKey(b.created_at))
    .slice(-14);

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => navigate(path)}
      onKeyDown={(event) => event.key === "Enter" && navigate(path)}
      className={cn("group flex cursor-pointer items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-2/60", noCi && "opacity-60 hover:opacity-100")}
    >
      <div className="flex w-6 justify-center">
        {loading ? <Skeleton className="size-[18px] rounded-full" /> : <StatusIcon state={scan?.state ?? "none"} className="size-[18px]" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Tooltip content={PROVIDER_LABELS[repo.provider].label}>
            <span className="shrink-0">
              <ProviderIcon provider={repo.provider} className="size-3.5" />
            </span>
          </Tooltip>
          <span className="truncate text-[14px]">
            <span className="text-fg-muted">{repo.owner}/</span>
            <span className="font-semibold">{repo.name}</span>
          </span>
          {repo.private ? (
            <Tooltip content={t("repos.private")}>
              <Lock className="size-3 shrink-0 text-fg-subtle" />
            </Tooltip>
          ) : null}
          {repo.fork ? <GitFork className="size-3 shrink-0 text-fg-subtle" /> : null}
          {repo.archived ? (
            <Badge>
              <Archive /> {t("repos.archived")}
            </Badge>
          ) : null}
          {localProject ? (
            <Tooltip content={t("repos.localClone", { path: localProject.display_path })}>
              <span
                className="inline-flex shrink-0 items-center text-fg-subtle hover:text-accent"
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(`${path}?tab=local`);
                }}
              >
                <Laptop className="size-3.5" />
              </span>
            </Tooltip>
          ) : null}
          {repo.added_manually ? (
            <Tooltip content={t("repos.addedManually")}>
              <Badge className="border-accent/20 bg-accent-soft text-accent">{t("repos.added")}</Badge>
            </Tooltip>
          ) : null}
          {repo.language ? <span className="hidden text-[12px] text-fg-subtle sm:inline">{repo.language}</span> : null}
        </div>
        <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5">
          {loading ? (
            <Skeleton className="h-4 w-48" />
          ) : error ? (
            <span className="text-[12px] text-failure">{error.message}</span>
          ) : noCi ? (
            <span className="text-[12px] text-fg-subtle">{t("repos.noPipeline")}</span>
          ) : (
            workflows.slice(0, 4).map((wf) => (
              <span
                key={wf.id}
                className="inline-flex h-5 items-center gap-1.5 rounded-md bg-surface-2 pr-1.5 pl-1 text-[11.5px] text-fg-muted ring-1 ring-line ring-inset"
              >
                <StatusIcon state={wf.latest_run?.state ?? "none"} className="size-3" />
                {wf.name}
              </span>
            ))
          )}
          {workflows.length > 4 ? <span className="text-[11.5px] text-fg-subtle">+{workflows.length - 4}</span> : null}
        </div>
      </div>

      <div className="hidden w-40 justify-end md:flex">
        {scan?.has_ci ? <HistoryStrip history={mainHistory} provider={repo.provider} fullName={repo.full_name} slots={14} /> : null}
      </div>

      <div className="w-28 text-right text-[12px] text-fg-muted">
        {scan?.last_run ? (
          <>
            <div className="font-medium text-fg">{stateLabel(scan.state)}</div>
            <TimeAgo date={scan.last_run.created_at} className="text-fg-subtle" />
          </>
        ) : repo.pushed_at ? (
          <TimeAgo date={repo.pushed_at} className="text-fg-subtle" />
        ) : null}
      </div>

      <Tooltip content={favorite ? t("repos.unfavorite") : t("repos.favorite")}>
        <button
          onClick={(event) => {
            event.stopPropagation();
            toggleFavorite(repo.key);
          }}
          className={cn(
            "flex size-7 items-center justify-center rounded-md transition-all hover:bg-surface-3",
            favorite ? "text-running" : "text-fg-subtle opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
          aria-label={favorite ? t("repos.unfavorite") : t("repos.favorite")}
        >
          <Star className={cn("size-4", favorite && "fill-current")} />
        </button>
      </Tooltip>

      <Menu>
        <MenuTrigger asChild>
          <button
            onClick={(event) => event.stopPropagation()}
            className="flex size-7 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-all group-hover:opacity-100 hover:bg-surface-3 hover:text-fg focus-visible:opacity-100 data-[state=open]:opacity-100"
            aria-label={t("common.moreActions")}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </MenuTrigger>
        <MenuContent>
          <div onClick={(event) => event.stopPropagation()}>
            <MenuItem icon={<ExternalLink />} onSelect={() => void api.openExternal(ciUrl(repo))}>
              {t("common.openOn", { provider: PROVIDER_LABELS[repo.provider].label })}
            </MenuItem>
            <MenuSeparator />
            {repo.added_manually ? (
              <MenuItem icon={<Trash2 />} description={t("repos.untrackDescription")} destructive onSelect={() => remove.mutate(repo.key)}>
                {t("repos.untrack")}
              </MenuItem>
            ) : (
              <MenuItem icon={<EyeOff />} description={t("repos.hideDescription")} onSelect={() => hide(repo.key)}>
                {t("repos.hide")}
              </MenuItem>
            )}
          </div>
        </MenuContent>
      </Menu>
    </div>
  );
}

/** Page des pipelines du dépôt sur la plateforme d'origine. */
function ciUrl(repo: Repository) {
  if (repo.provider === "gitlab") return `${repo.html_url}/-/pipelines`;
  if (repo.provider === "bitbucket") return `${repo.html_url}/pipelines`;
  return `${repo.html_url}/actions`;
}
