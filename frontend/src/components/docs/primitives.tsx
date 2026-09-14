import { CircleHelp, ExternalLink, Lightbulb, ShieldCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Éléments de mise en page                                                   */
/* -------------------------------------------------------------------------- */

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 mb-2 text-[14.5px] font-semibold text-fg">{children}</h3>;
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("my-2.5 text-[13.5px] leading-[1.7] text-fg-muted", className)}>{children}</p>;
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-fg">{children}</strong>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg ring-1 ring-line ring-inset">{children}</code>;
}

export function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative my-3">
      <pre className="scrollbar-thin overflow-x-auto rounded-xl border border-line bg-log px-4 py-3 font-mono text-[12.5px] text-fg">{children}</pre>
      <button
        onClick={() => void navigator.clipboard.writeText(children).then(() => setCopied(true))}
        onMouseLeave={() => setCopied(false)}
        className="absolute top-2 right-2 rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"
      >
        {copied ? i18n.t("common.copied") : i18n.t("common.copy")}
      </button>
    </div>
  );
}

export function ExternalButton({ href, children }: { href: string; children: ReactNode }) {
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

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
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

export function Question({ question, children }: { question: string; children: ReactNode }) {
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
/* Section de documentation                                                   */
/* -------------------------------------------------------------------------- */

export interface DocSection {
  id: string;
  title: string;
  icon: LucideIcon;
  summary: string;
  content: ReactNode;
}
