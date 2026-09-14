import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  Copy,
  Search,
  TriangleAlert,
  WrapText,
  X,
} from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import i18n from "@/i18n";
import type { JobLog, LogLine, LogSegment } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";
import { Tooltip } from "./ui/overlays";
import { Button, Kbd } from "./ui/primitives";

type AvailableLog = Extract<JobLog, { available: true }>;

export interface LogViewerHandle {
  jumpToLine: (line: number) => void;
  jumpToGroup: (title: string) => boolean;
}

export function plainText(line: LogLine) {
  return line.segments.map((s) => s.t).join("");
}

function ansiColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (color.startsWith("#")) return color;
  if (color === "bright-black") return "var(--ansi-bright-black)";
  return `var(--ansi-${color.replace("bright-", "")})`;
}

function segmentStyle(segment: LogSegment): CSSProperties | undefined {
  if (!segment.fg && !segment.bg && !segment.b && !segment.d && !segment.i && !segment.u) return undefined;
  return {
    color: ansiColor(segment.fg),
    background: segment.bg ? `color-mix(in oklab, ${ansiColor(segment.bg)} 30%, transparent)` : undefined,
    fontWeight: segment.b ? 700 : undefined,
    opacity: segment.d ? 0.65 : undefined,
    fontStyle: segment.i ? "italic" : undefined,
    textDecoration: segment.u ? "underline" : undefined,
  };
}

/** Rend un segment en surlignant les occurrences de la recherche. */
function Highlighted({ text, query, style }: { text: string; query: string; style?: CSSProperties }) {
  if (!query) return <span style={style}>{text}</span>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let index = 0;
  let found = lower.indexOf(query, index);
  while (found !== -1) {
    if (found > index) parts.push(text.slice(index, found));
    parts.push(
      <mark key={found} className="rounded-[2px] bg-running/35 text-inherit">
        {text.slice(found, found + query.length)}
      </mark>,
    );
    index = found + query.length;
    found = lower.indexOf(query, index);
  }
  if (index < text.length) parts.push(text.slice(index));
  return <span style={style}>{parts}</span>;
}

export const LogViewer = forwardRef<LogViewerHandle, { log: AvailableLog; className?: string }>(({ log, className }, ref) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Choix explicites de l'utilisateur ; les autres groupes suivent leur état par défaut (utile quand le log grandit).
  const [overrides, setOverrides] = useState<Map<number, boolean>>(() => new Map());
  const [wrap, setWrap] = useState(true);
  const [timestamps, setTimestamps] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [errorIndex, setErrorIndex] = useState(-1);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [follow, setFollow] = useState(true);
  const live = !log.complete;
  const positioned = useRef(false);

  const normalizedQuery = query.trim().toLowerCase();

  const isCollapsed = useCallback((id: number) => overrides.get(id) ?? log.groups[id]?.collapsed ?? false, [overrides, log.groups]);
  const collapsed = useMemo(() => new Set(log.groups.filter((g) => isCollapsed(g.id)).map((g) => g.id)), [log.groups, isCollapsed]);

  const visible = useMemo(
    () => log.lines.map((_, i) => i).filter((i) => log.lines[i].group === undefined || !collapsed.has(log.lines[i].group!)),
    [log.lines, collapsed],
  );
  const positionOf = useMemo(() => new Map(visible.map((line, position) => [line, position])), [visible]);

  const matches = useMemo(() => {
    if (normalizedQuery.length < 2) return [];
    return log.lines.flatMap((line, i) => (plainText(line).toLowerCase().includes(normalizedQuery) ? [i] : []));
  }, [log.lines, normalizedQuery]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 30,
  });

  const setGroupCollapsed = (id: number, value: boolean) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(id, value);
      return next;
    });

  const reveal = useCallback(
    (line: number) => {
      const group = log.lines[line]?.group;
      setFocusLine(line);
      setFollow(false);
      if (group !== undefined && collapsed.has(group)) {
        setGroupCollapsed(group, false);
        return; // le défilement se fera après recalcul des lignes visibles (effet ci-dessous)
      }
      const position = positionOf.get(line);
      if (position !== undefined) virtualizer.scrollToIndex(position, { align: "center" });
    },
    [collapsed, log.lines, positionOf, virtualizer],
  );

  useEffect(() => {
    if (focusLine === null) return;
    const position = positionOf.get(focusLine);
    if (position !== undefined) virtualizer.scrollToIndex(position, { align: "center" });
  }, [positionOf]);

  useImperativeHandle(
    ref,
    () => ({
      jumpToLine: reveal,
      jumpToGroup: (title) => {
        const group = log.groups.find((g) => g.title === title);
        if (!group) return false;
        reveal(group.line);
        return true;
      },
    }),
    [reveal, log.groups],
  );

  // Positionnement initial : sur la première erreur, sinon en fin de log. Rejoué une fois quand un log en direct se termine en erreur.
  const finishedWithErrors = log.complete && log.errors.length > 0;
  useEffect(() => {
    if (positioned.current && !(finishedWithErrors && follow)) return;
    positioned.current = true;
    if (log.errors.length) {
      setErrorIndex(0);
      requestAnimationFrame(() => reveal(log.errors[0]));
    } else {
      requestAnimationFrame(() => virtualizer.scrollToIndex(visible.length - 1, { align: "end" }));
    }
  }, [finishedWithErrors]);

  // Logs en direct : on reste collé à la fin tant que l'utilisateur ne remonte pas dans le log.
  useEffect(() => {
    if (live && follow && visible.length) virtualizer.scrollToIndex(visible.length - 1, { align: "end" });
  }, [visible.length, live, follow]);

  useEffect(() => {
    setMatchIndex(0);
    if (matches.length) reveal(matches[0]);
  }, [normalizedQuery]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const goToMatch = (delta: number) => {
    if (!matches.length) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    reveal(matches[next]);
  };

  const goToError = () => {
    if (!log.errors.length) return;
    const next = (errorIndex + 1) % log.errors.length;
    setErrorIndex(next);
    reveal(log.errors[next]);
  };

  const toggleGroup = (id: number) => setGroupCollapsed(id, !collapsed.has(id));

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element || !live) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const allCollapsed = collapsed.size === log.groups.length;
  const lineNumberWidth = String(log.lines.length).length;

  return (
    <div
      className={cn("flex min-h-0 flex-col", className)}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
          event.preventDefault();
          searchRef.current?.focus();
        }
      }}
    >
      {/* Barre d'outils */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="flex h-7 w-64 items-center gap-2 rounded-md border border-line bg-surface px-2 focus-within:border-accent/60 focus-within:ring-3 focus-within:ring-accent/15">
          <Search className="size-3.5 shrink-0 text-fg-subtle" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") goToMatch(event.shiftKey ? -1 : 1);
              if (event.key === "Escape") setQuery("");
            }}
            placeholder={i18n.t("logs.search")}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-fg-subtle"
          />
          {normalizedQuery.length >= 2 ? (
            <span className="shrink-0 text-[11px] text-fg-subtle tabular">{matches.length ? `${matchIndex + 1}/${matches.length}` : "0"}</span>
          ) : (
            <Kbd className="h-4 text-[10px]">⌘F</Kbd>
          )}
          {query ? (
            <button onClick={() => setQuery("")} className="text-fg-subtle hover:text-fg" aria-label={i18n.t("logs.clear")}>
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => goToMatch(-1)} disabled={!matches.length} aria-label={i18n.t("common.previous")}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => goToMatch(1)} disabled={!matches.length} aria-label={i18n.t("common.next")}>
          <ArrowDown />
        </Button>

        <div className="ml-auto flex items-center gap-1">
          {live ? (
            <Tooltip content={follow ? i18n.t("logs.followOn") : i18n.t("logs.followOff")}>
              <button
                onClick={() => {
                  setFollow(true);
                  virtualizer.scrollToIndex(visible.length - 1, { align: "end" });
                }}
                className={cn(
                  "mr-1 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors",
                  follow ? "bg-running/15 text-fg" : "bg-surface-2 text-fg-muted hover:text-fg",
                )}
              >
                <span className="relative inline-flex size-2">
                  {follow ? <span className="absolute inset-0 animate-ping rounded-full bg-running opacity-60" /> : null}
                  <span className="relative size-2 rounded-full bg-running" />
                </span>
                {follow ? i18n.t("logs.live") : i18n.t("logs.follow")}
              </button>
            </Tooltip>
          ) : null}
          {log.errors.length ? (
            <Button variant="danger" size="sm" onClick={goToError}>
              <TriangleAlert className="size-3.5" />
              {log.errors.length > 1 ? i18n.t("logs.errorN", { index: errorIndex + 1, total: log.errors.length }) : i18n.t("logs.goToError")}
            </Button>
          ) : null}
          <ToolbarToggle label={i18n.t("logs.timestamps")} active={timestamps} onClick={() => setTimestamps((v) => !v)} icon={<Clock />} />
          <ToolbarToggle label={i18n.t("logs.wrap")} active={wrap} onClick={() => setWrap((v) => !v)} icon={<WrapText />} />
          <ToolbarToggle
            label={allCollapsed ? i18n.t("logs.expandAll") : i18n.t("logs.collapseAll")}
            active={false}
            onClick={() => setOverrides(new Map(log.groups.map((g) => [g.id, !allCollapsed])))}
            icon={allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
          />
          <ToolbarToggle
            label={i18n.t("logs.copy")}
            active={false}
            onClick={() => void navigator.clipboard.writeText(log.lines.map(plainText).join("\n")).then(() => setCopied(true))}
            icon={copied ? <Check className="text-success" /> : <Copy />}
          />
        </div>
      </div>

      {log.truncated ? (
        <div className="border-b border-line bg-running/10 px-4 py-1.5 text-[12px] text-fg-muted">
          {i18n.t("logs.truncated", { count: log.line_count, formatted: formatNumber(log.line_count) })}
        </div>
      ) : null}

      {/* Lignes */}
      <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-log py-2 font-mono text-[12px] leading-5">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", minWidth: wrap ? undefined : "max-content" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const index = visible[item.index];
            const line = log.lines[index];
            const isGroup = line.kind === "group";
            const isCollapsed = isGroup && collapsed.has(line.header!);
            const group = isGroup ? log.groups[line.header!] : undefined;
            const isMatch = matches.length > 0 && matches[matchIndex] === index;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={cn(
                  "group/line absolute left-0 flex w-full border-l-2 border-transparent pr-4",
                  line.kind === "error" && "border-failure bg-failure/10",
                  line.kind === "warning" && "border-running bg-running/8",
                  line.kind === "command" && "text-ansi-cyan",
                  isGroup && "cursor-pointer hover:bg-surface-2/70",
                  focusLine === index && line.kind !== "error" && "bg-accent-soft",
                  isMatch && "ring-1 ring-running/60 ring-inset",
                )}
                style={{ transform: `translateY(${item.start}px)` }}
                onClick={isGroup ? () => toggleGroup(line.header!) : () => setFocusLine(index)}
              >
                <span
                  className="shrink-0 pr-3 pl-3 text-right text-fg-subtle/70 select-none group-hover/line:text-fg-subtle"
                  style={{ width: `${lineNumberWidth + 3}ch` }}
                >
                  {index + 1}
                </span>
                {timestamps ? (
                  <span className="shrink-0 pr-3 text-fg-subtle select-none">{line.ts ? line.ts.slice(11, 19) : "        "}</span>
                ) : null}
                <span
                  className={cn(
                    "min-w-0 flex-1",
                    wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre",
                    line.group !== undefined && "pl-5",
                    line.kind === "error" && "font-medium text-failure",
                    line.kind === "warning" && "text-ansi-yellow",
                    line.kind === "debug" && "text-fg-subtle",
                    line.kind === "command" && "text-ansi-cyan",
                  )}
                >
                  {isGroup ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-fg">
                      <ChevronRight className={cn("size-3.5 text-fg-subtle transition-transform", !isCollapsed && "rotate-90")} />
                      {group?.has_error ? <span className="size-1.5 rounded-full bg-failure" /> : null}
                      <Highlighted text={group?.title ?? plainText(line)} query={normalizedQuery} />
                      {isCollapsed && group ? (
                        <span className="ml-2 font-normal text-fg-subtle">{i18n.t("logs.lines", { count: group.end - group.line })}</span>
                      ) : null}
                    </span>
                  ) : line.kind === "error" ? (
                    <>
                      <span className="mr-2 rounded bg-failure px-1 py-px text-[10.5px] font-semibold text-white">{i18n.t("logs.errorBadge")}</span>
                      {line.segments.map((segment, i) => (
                        <Highlighted key={i} text={segment.t} query={normalizedQuery} />
                      ))}
                    </>
                  ) : line.kind === "warning" ? (
                    <>
                      <span className="mr-2 rounded bg-running px-1 py-px text-[10.5px] font-semibold text-black">{i18n.t("logs.warningBadge")}</span>
                      {line.segments.map((segment, i) => (
                        <Highlighted key={i} text={segment.t} query={normalizedQuery} />
                      ))}
                    </>
                  ) : (
                    line.segments.map((segment, i) => <Highlighted key={i} text={segment.t} query={normalizedQuery} style={segmentStyle(segment)} />)
                  )}
                  {line.segments.length === 1 && line.segments[0].t === "" ? " " : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
LogViewer.displayName = "LogViewer";

function ToolbarToggle({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label} aria-pressed={active} className={cn(active && "bg-surface-2 text-fg")}>
        {icon}
      </Button>
    </Tooltip>
  );
}
