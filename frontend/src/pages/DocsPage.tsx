import { ArrowRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { useDocSections } from "@/components/docs/DocsContent";
import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function DocsPage() {
  const { t } = useTranslation();
  const DOC_SECTIONS = useDocSections();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(params.get("section") ?? DOC_SECTIONS[0].id);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollingTo = useRef<string | null>(null);
  const lastNavigated = useRef<string | null>(null);
  const requestedSection = params.get("section");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOC_SECTIONS;
    return DOC_SECTIONS.filter((section) => `${section.title} ${section.summary}`.toLowerCase().includes(q));
  }, [query, DOC_SECTIONS]);

  const goTo = (id: string, behavior: ScrollBehavior = "smooth") => {
    const element = document.getElementById(`doc-${id}`);
    if (!element) return;
    scrollingTo.current = id;
    lastNavigated.current = id;
    setActive(id);
    element.scrollIntoView({ behavior, block: "start" });
    setParams({ section: id }, { replace: true });
    window.setTimeout(() => (scrollingTo.current = null), 700);
  };

  // Ouverture directe sur une section (liens « En savoir plus » depuis l'app).
  useEffect(() => {
    if (requestedSection && requestedSection !== lastNavigated.current) requestAnimationFrame(() => goTo(requestedSection, "auto"));
  }, [requestedSection]);

  // Section active selon la position de défilement.
  useEffect(() => {
    const root = containerRef.current?.closest("main");
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollingTo.current) return;
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.replace("doc-", ""));
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    );
    DOC_SECTIONS.forEach((section) => {
      const element = document.getElementById(`doc-${section.id}`);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [DOC_SECTIONS]);

  return (
    <div ref={containerRef} className="mx-auto flex w-full max-w-[1180px] gap-10 px-8 py-7 animate-fade-in">
      <aside className="sticky top-7 hidden h-[calc(100vh-7rem)] w-60 shrink-0 flex-col lg:flex">
        <Input icon={<Search />} placeholder={t("docs.search")} value={query} onChange={(event) => setQuery(event.target.value)} data-page-search />
        <nav className="scrollbar-thin mt-4 -mr-2 flex-1 overflow-y-auto pr-2" aria-label={t("docs.toc")}>
          {filtered.map((section) => {
            const Icon = section.icon;
            const isActive = active === section.id;
            return (
              <button
                key={section.id}
                onClick={() => goTo(section.id)}
                className={cn(
                  "mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
                  isActive ? "bg-surface-2 font-medium text-fg ring-1 ring-line ring-inset" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
                )}
              >
                <Icon className={cn("size-4 shrink-0", isActive ? "text-accent" : "text-fg-subtle")} />
                <span className="truncate">{section.title}</span>
              </button>
            );
          })}
          {filtered.length === 0 ? <p className="px-2.5 text-[12.5px] text-fg-subtle">{t("docs.noMatch")}</p> : null}
        </nav>
      </aside>

      <article className="min-w-0 max-w-[760px] flex-1 pb-24">
        <header className="mb-8 border-b border-line pb-7">
          <div className="text-[12px] font-semibold tracking-wide text-accent uppercase">{t("docs.eyebrow")}</div>
          <h1 className="mt-1.5 text-[28px] font-semibold tracking-tight">{t("docs.title")}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
            {t("docs.intro")}
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {["accounts", "repositories", "errors"].map((id) => DOC_SECTIONS.find((section) => section.id === id)!).map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  onClick={() => goTo(section.id)}
                  className="group rounded-xl border border-line bg-surface p-3.5 text-left shadow-soft transition-shadow hover:shadow-pop"
                >
                  <Icon className="size-4 text-accent" />
                  <div className="mt-2 flex items-center gap-1 text-[13px] font-semibold">
                    {section.title}
                    <ArrowRight className="size-3.5 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <div className="mt-0.5 text-[12px] leading-snug text-fg-muted">{section.summary}</div>
                </button>
              );
            })}
          </div>
        </header>

        {DOC_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <section key={section.id} id={`doc-${section.id}`} className="mb-14 scroll-mt-6">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon className="size-4" />
                </span>
                <h2 className="text-[20px] font-semibold tracking-tight">{section.title}</h2>
              </div>
              {section.content}
            </section>
          );
        })}
      </article>
    </div>
  );
}
