import { CircleArrowUp, Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/ui/overlays";
import { Badge, Button } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import type { InstallMethod, UpdateCheck } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

export const INSTALL_METHOD_LABELS: Record<InstallMethod, string> = {
  homebrew: "installé avec Homebrew",
  script: "installé avec le script d'installation",
  manual: "installé depuis une archive téléchargée",
  source: "lancé depuis les sources",
};

export function UpdateDialog({ open, onOpenChange, check, onSkip }: { open: boolean; onOpenChange: (open: boolean) => void; check: UpdateCheck; onSkip: () => void }) {
  const latest = check.latest!;
  const notes = cleanNotes(latest.notes);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      className="w-[min(580px,calc(100vw-48px))]"
      title={
        <span className="flex items-center gap-2">
          <CircleArrowUp className="size-4.5 text-accent" /> Nouvelle version disponible
        </span>
      }
      description={
        <>
          Easy CI <strong className="font-semibold text-fg">{latest.version}</strong> est disponible — vous utilisez la version {check.current_version}
          {latest.published_at ? `. Publiée le ${formatDate(latest.published_at)}.` : "."}
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        {notes ? (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">Nouveautés</div>
            <div className="scrollbar-thin max-h-40 overflow-y-auto rounded-lg border border-line bg-surface-2/50 px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg-muted">
              {notes}
            </div>
          </div>
        ) : null}

        {check.instructions.length ? (
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
              Mettre à jour
              <Badge className="normal-case tracking-normal">{INSTALL_METHOD_LABELS[check.install_method]}</Badge>
            </div>
            <div className="space-y-2">
              {check.instructions.map((instruction, index) => (
                <CommandBlock key={instruction.command} label={instruction.label} command={instruction.command} primary={index === 0} />
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">
              Collez la commande dans un terminal{navigator.userAgent.includes("Windows") ? " PowerShell" : ""}, puis relancez Easy CI. Vos comptes et préférences sont conservés.
            </p>
          </div>
        ) : (
          <p className="text-[12.5px] text-fg-muted">Téléchargez la nouvelle version depuis la page de publication et remplacez l'ancienne.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3.5">
        <Button variant="ghost" onClick={onSkip}>
          Ignorer cette version
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => void api.openExternal(latest.url)}>
            <ExternalLink /> Voir la version
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            Plus tard
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
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
      <pre className="scrollbar-thin overflow-x-auto px-3 pt-1 pb-2.5 font-mono text-[12px] text-fg select-all">{command}</pre>
    </div>
  );
}

/** Notes de version GitHub (Markdown) → texte lisible, sans le tableau de téléchargements ajouté par la CI. */
function cleanNotes(markdown: string) {
  return markdown
    .replace(/## Téléchargements[\s\S]*?(?=\n## |\n\*\*Full Changelog|$)/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
