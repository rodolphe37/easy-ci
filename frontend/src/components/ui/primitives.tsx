import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import logoDarkUrl from "@/assets/brand/logo-dark.png";
import logoUrl from "@/assets/brand/logo.png";
import markUrl from "@/assets/brand/mark.png";
import { cn, initials } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(0_0_0/0.15)]",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3 border border-line",
  outline: "border border-line-strong text-fg hover:bg-surface-2",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-2",
  danger: "bg-failure/10 text-failure hover:bg-failure/15 border border-failure/20",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md",
  md: "h-8 px-3 text-[13px] gap-2 rounded-lg",
  lg: "h-10 px-4 text-[14px] gap-2 rounded-lg",
  icon: "h-8 w-8 rounded-lg",
  "icon-sm": "h-7 w-7 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/** Classes d'un bouton, réutilisables sur un lien (<Link className={buttonClass(…)}>). */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background,color,box-shadow,opacity,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", loading, className, children, disabled, ...props }, ref) => (
    <button ref={ref} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...props}>
      {loading ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

/* -------------------------------------------------------------------------- */
/* Petits éléments                                                            */
/* -------------------------------------------------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 animate-spin", className)} fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 text-[11px] font-medium text-fg-muted [&_svg]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-sans text-[10.5px] font-medium text-fg-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-line bg-surface shadow-soft", className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center animate-fade-in", className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-line bg-surface-2 text-fg-muted [&_svg]:size-5">
        {icon}
      </div>
      <h3 className="text-[14px] font-semibold text-fg">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-[13px] text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

const AVATAR_TINTS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6"];

export function Avatar({ login, src, size = 20, className }: { login?: string | null; src?: string | null; size?: number; className?: string }) {
  const tint = AVATAR_TINTS[[...(login ?? "")].reduce((sum, c) => sum + c.charCodeAt(0), 0) % AVATAR_TINTS.length];
  return src ? (
    <img src={src} alt="" width={size} height={size} className={cn("shrink-0 rounded-full ring-1 ring-line", className)} />
  ) : (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.4, background: tint }}
      aria-hidden
    >
      {initials(login)}
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
        checked ? "bg-accent" : "bg-surface-3 ring-1 ring-inset ring-line-strong",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-6.5 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-all duration-150 [&_svg]:size-3.5",
              active ? "bg-surface text-fg shadow-soft ring-1 ring-line" : "text-fg-muted hover:text-fg",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={cn("tabular text-[11px]", active ? "text-fg-muted" : "text-fg-subtle")}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; trailing?: ReactNode }>(
  ({ icon, trailing, className, ...props }, ref) => (
    <div
      className={cn(
        "flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 transition-[border,box-shadow] focus-within:border-accent/60 focus-within:ring-3 focus-within:ring-accent/15 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-subtle",
        className,
      )}
    >
      {icon}
      <input
        ref={ref}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle"
        {...props}
      />
      {trailing}
    </div>
  ),
);
Input.displayName = "Input";

export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4", className)} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** Symbole ∞ de la marque, pensé pour les petites tailles (barre latérale, écrans de chargement). */
export function Logo({ className }: { className?: string }) {
  return (
    <img
      src={markUrl}
      alt="Easy CI"
      draggable={false}
      className={cn("size-7 shrink-0 drop-shadow-[0_2px_6px_rgb(60_90_255/0.35)] select-none", className)}
    />
  );
}

/** Illustration complète de la marque, avec une variante dédiée au thème sombre. */
export function BrandIllustration({ className }: { className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <img src={logoUrl} alt="Easy CI" draggable={false} className="size-full object-contain select-none dark:hidden" />
      <img src={logoDarkUrl} alt="" aria-hidden draggable={false} className="hidden size-full object-contain select-none dark:block" />
    </div>
  );
}
