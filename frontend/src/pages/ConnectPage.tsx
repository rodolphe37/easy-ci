import { ArrowRight, Lock, Sparkles } from "lucide-react";
import { useState } from "react";
import { ConnectAccountForm } from "@/components/ConnectAccountForm";
import { ProviderGuide } from "@/components/docs/DocsContent";
import { Modal } from "@/components/ui/overlays";
import { BrandIllustration, Button, Logo } from "@/components/ui/primitives";
import { useSessionActions } from "@/hooks/session";
import { PROVIDER_LABELS } from "@/lib/providers";
import type { ProviderId, Session } from "@/lib/types";

export function ConnectPage({ session }: { session: Session | undefined }) {
  const [guide, setGuide] = useState<ProviderId | null>(null);
  const { startDemo } = useSessionActions();
  const restoreErrors = session?.restore_errors ?? [];

  return (
    <div className="relative flex h-full overflow-hidden">
      <Backdrop />

      <div className="scrollbar-thin relative z-10 flex flex-1 items-center justify-center overflow-y-auto p-8">
        <div className="w-full max-w-[420px] animate-fade-in">
          <div className="flex items-center gap-3">
            <Logo className="size-11" />
            <span className="text-[18px] font-semibold tracking-tight">Easy CI</span>
          </div>
          <h1 className="mt-7 text-[26px] leading-tight font-semibold tracking-tight">
            Vos pipelines CI/CD,
            <br />
            <span className="bg-[linear-gradient(90deg,#1fa2ff,#6d5dfc_55%,#9b5cf6)] bg-clip-text text-transparent">enfin sous contrôle.</span>
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
            Connectez GitHub, GitLab ou Bitbucket pour détecter automatiquement les pipelines de vos dépôts et suivre chaque exécution en direct.
            Vous pourrez ajouter les autres plateformes ensuite.
          </p>

          {restoreErrors.length ? (
            <div className="mt-5 rounded-xl border border-running/30 bg-running/[0.07] p-3 text-[12.5px] leading-relaxed text-fg-muted">
              {restoreErrors.map((error) => (
                <p key={error.provider}>
                  <span className="font-semibold text-fg">{PROVIDER_LABELS[error.provider].label} :</span> {error.message}
                </p>
              ))}
            </div>
          ) : null}

          <div className="mt-7">
            <ConnectAccountForm initialProvider={restoreErrors[0]?.provider ?? "github"} onOpenGuide={setGuide} />
          </div>

          <div className="my-6 flex items-center gap-3 text-[12px] text-fg-subtle">
            <div className="h-px flex-1 bg-line" />
            ou
            <div className="h-px flex-1 bg-line" />
          </div>

          <Button size="lg" variant="outline" onClick={() => startDemo.mutate()} loading={startDemo.isPending} className="group w-full">
            <Sparkles className="text-accent" />
            Explorer en mode démo
            <ArrowRight className="text-fg-subtle transition-transform group-hover:translate-x-0.5" />
          </Button>

          <p className="mt-8 flex items-start gap-2 text-[12px] leading-relaxed text-fg-subtle">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            Les identifiants sont stockés dans le trousseau sécurisé de votre système et ne sont envoyés qu'à la plateforme concernée.
          </p>
        </div>
      </div>

      <Showcase />

      <Modal
        open={guide !== null}
        onOpenChange={(open) => !open && setGuide(null)}
        title={guide ? `Connecter ${PROVIDER_LABELS[guide].label}` : ""}
        description="Créer un token, choisir les droits et se connecter."
        className="w-[min(760px,calc(100vw-48px))]"
      >
        <div className="scrollbar-thin max-h-[min(640px,72vh)] overflow-y-auto px-6 pb-6">{guide ? <ProviderGuide provider={guide} /> : null}</div>
      </Modal>
    </div>
  );
}

function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute -top-40 -left-40 size-[520px] rounded-full bg-accent/10 blur-3xl" />
      <div className="absolute right-[20%] -bottom-48 size-[480px] rounded-full bg-[#8b5cf6]/10 blur-3xl" />
      <div
        className="absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        style={{ backgroundImage: "radial-gradient(var(--line-strong) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
      />
    </div>
  );
}

/** Illustration de la marque, affichée sur les grands écrans. */
function Showcase() {
  return (
    <div className="relative z-10 hidden flex-1 items-center justify-center p-10 lg:flex">
      <div className="relative w-full max-w-[520px] animate-pop-in">
        <div className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,rgb(59_130_246/0.28),rgb(139_92_246/0.18)_45%,transparent_70%)] blur-2xl" aria-hidden />
        <BrandIllustration className="relative aspect-square w-full animate-float" />
      </div>
    </div>
  );
}
