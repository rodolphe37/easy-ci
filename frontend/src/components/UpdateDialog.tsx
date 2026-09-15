import { CircleArrowUp, Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Modal } from "@/components/ui/overlays";
import { Badge, Button } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import type { InstallMethod, UpdateCheck } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

export function installMethodLabel(method: InstallMethod): string {
  return i18n.t(`updates.installMethods.${method}`);
}

export function UpdateDialog({ open, onOpenChange, check, onSkip }: { open: boolean; onOpenChange: (open: boolean) => void; check: UpdateCheck; onSkip: () => void }) {
  const { t } = useTranslation();
  const latest = check.latest!;
  const notes = cleanNotes(latest.notes);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      className="w-[min(580px,calc(100vw-48px))]"
      title={
        <span className="flex items-center gap-2">
          <CircleArrowUp className="size-4.5 text-accent" /> {t("updates.dialog.title")}
        </span>
      }
      description={
        <>
          <Trans i18nKey="updates.dialog.available" values={{ latest: latest.version, current: check.current_version }} components={{ strong: <strong className="font-semibold text-fg" /> }} />
          {latest.published_at ? ` ${t("updates.dialog.published", { date: formatDate(latest.published_at) })}` : ""}
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        {notes ? (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">{t("updates.dialog.notes")}</div>
            <div className="scrollbar-thin max-h-40 overflow-y-auto rounded-lg border border-line bg-surface-2/50 px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg-muted">
              {notes}
            </div>
          </div>
        ) : null}

        {check.instructions.length ? (
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
              {t("updates.dialog.update")}
              <Badge className="normal-case tracking-normal">{installMethodLabel(check.install_method)}</Badge>
            </div>
            <div className="space-y-2">
              {check.instructions.map((instruction, index) => (
                <CommandBlock key={instruction.command} label={instruction.label} command={instruction.command} primary={index === 0} />
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">
              {navigator.userAgent.includes("Windows") ? t("updates.dialog.pasteWindows") : t("updates.dialog.paste")}
            </p>
          </div>
        ) : (
          <p className="text-[12.5px] text-fg-muted">{t("updates.dialog.manual")}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3.5">
        <Button variant="ghost" onClick={onSkip}>
          {t("updates.dialog.skip")}
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => void api.openExternal(latest.url)}>
            <ExternalLink /> {t("updates.dialog.view")}
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            {t("updates.dialog.later")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CommandBlock({ label, command, primary }: { label: string; command: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("rounded-lg border", primary ? "border-accent/30 bg-accent-soft/40" : "border-line bg-surface")}>
      <div className="flex items-center justify-between px-3 pt-2 text-[11.5px] font-medium text-fg-muted">
        {label}
        <button
          onClick={() =>
            void navigator.clipboard.writeText(command).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
          {copied ? i18n.t("common.copied") : i18n.t("common.copy")}
        </button>
      </div>
      <pre className="scrollbar-thin overflow-x-auto px-3 pt-1 pb-2.5 font-mono text-[12px] text-fg select-all">{command}</pre>
    </div>
  );
}

/** Bloc de la langue de l'interface dans des notes bilingues (<!-- lang:fr --> … <!-- /lang -->), sinon les notes entières. */
function localizedNotes(markdown: string, language: string) {
  const blocks = new Map([...markdown.matchAll(/<!--\s*lang:([a-z]{2})\s*-->([\s\S]*?)<!--\s*\/lang\s*-->/g)].map((match) => [match[1], match[2]]));
  return blocks.get(language) ?? blocks.get("en") ?? blocks.values().next().value ?? markdown;
}

/** Notes de version GitHub (Markdown) → texte lisible, sans les sections de téléchargement et d'installation ajoutées par la CI. */
function cleanNotes(markdown: string) {
  return localizedNotes(markdown, i18n.resolvedLanguage === "fr" ? "fr" : "en")
    .replace(/^## (Téléchargements|Downloads|Installation en une commande|One-command install)\n[\s\S]*?(?=^## |^\*\*(Full [Cc]hangelog|Toutes les modifications)|(?![\s\S]))/gm, "")
    .replace(/^## (Nouveautés|What's new)\s*$/gm, "")
    .replace(/^\*\*(Full [Cc]hangelog|Toutes les modifications)\*\*.*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
