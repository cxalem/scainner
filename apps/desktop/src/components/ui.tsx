// The design system's component layer. Every primitive here is built from
// the tokens in theme/tokens.css (through the Tailwind names mapped in
// index.css) — no hex, no ad-hoc px radius, no one-off easing. Views compose
// these; they do not restyle them.
//
// Type scale used across the app (from the Hi-Fi v2 handoff):
//   page title 22 · card head 19 · body 13.5/13 · secondary 12.5/12/11.5
//   kicker 10.5 uppercase +0.1em · pill 10.5 · nav 13 · stat number 23 mono
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { backdropVariants, modalPanelVariants } from "@/motion";

// ---------- Surfaces ----------
/** A white surface on the paper background. `flush` removes the padding
 *  for cards that hold their own header/table rows. */
export function Card({
  className,
  flush = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-md bg-surface shadow-sm",
        flush ? "overflow-hidden" : "gap-2.5 px-[17px] py-[15px]",
        className,
      )}
      {...props}
    />
  );
}

/** Card head row: icon in accent, 13.5px title, optional right slot. */
export function CardHead({
  icon: Icon,
  title,
  aside,
  className,
  divided = false,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  /** Inside a `flush` card: draws the bottom rule and its own padding. */
  divided?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        divided && "border-b border-divider px-[17px] py-[13px]",
        className,
      )}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 text-accent-400" aria-hidden="true" />}
      <span className="flex-1 text-[13.5px]">{title}</span>
      {aside && <span className="text-[11.5px] text-neutral-500">{aside}</span>}
    </div>
  );
}

/** Uppercase 10.5px label above a group of fields or a list. */
export function Kicker({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("text-[10.5px] uppercase tracking-[0.1em] text-neutral-500", className)}
      {...props}
    />
  );
}

/** A section label with a rule fading out to the right ("Standard OBD ——"). */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Kicker className="tracking-[0.12em]">{children}</Kicker>
      <span className="rule-fade flex-1" aria-hidden="true" />
    </div>
  );
}

/** Page head: kicker / 22px title / lede, with a right-hand slot. */
export function PageHeader({
  kicker,
  title,
  lede,
  aside,
}: {
  kicker: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex flex-1 flex-col gap-[3px]">
        <Kicker className="tracking-[0.12em]">{kicker}</Kicker>
        <h1 className="text-[22px]">{title}</h1>
        {lede && <p className="mt-0.5 max-w-[64ch] text-[13px] leading-[1.55] text-neutral-500">{lede}</p>}
      </div>
      {aside}
    </div>
  );
}

/** Secondary explanatory line (12.5px, neutral-500). */
export function Note({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[12.5px] leading-[1.55] text-neutral-500", className)} {...props} />;
}

/** Monospace reading: a code, a VIN, a byte, a value. */
export function Mono({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("num", className)} {...props} />;
}

// ---------- Skeleton ----------
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-neutral-900", className)} {...props} />;
}

/** A Card-shaped loading placeholder sized to what it stands in for, so
 *  nothing shifts once real data lands. */
export function CardSkeleton({
  title = true,
  rows = 3,
  contentClassName,
}: {
  title?: boolean;
  rows?: number;
  contentClassName?: string;
}) {
  return (
    <Card>
      {title && <Skeleton className="h-3.5 w-32" />}
      {contentClassName ? (
        <Skeleton className={cn("w-full", contentClassName)} />
      ) : (
        <div className="flex flex-col gap-2">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 w-full" />
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------- Button ----------
// primary: outlined in the accent (the design's single-voice button —
//          filled buttons would shout on a paper-white app)
// secondary: outlined in the divider
// ghost: accent text, no border
type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";
export function Button({
  className,
  variant = "secondary",
  size = "md",
  block = false,
  icon: Icon,
  busy = false,
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: LucideIcon;
  /** Shows a spinner in the icon slot and disables the button. */
  busy?: boolean;
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: "border-accent text-accent hover:bg-accent/10 active:bg-accent/20",
    secondary: "border-divider text-text hover:bg-text/5 active:bg-text/10",
    ghost: "border-transparent text-accent hover:bg-accent/8 active:bg-accent/15",
    destructive: "border-stop-line text-stop hover:bg-stop-bg active:bg-stop-line/60",
  };
  const sizes: Record<ButtonSize, string> = {
    sm: "h-7 px-2.5 text-[12px] [&_svg]:h-3.5 [&_svg]:w-3.5",
    md: "h-8 px-3 text-[13px] [&_svg]:h-[15px] [&_svg]:w-[15px]",
    lg: "h-10 px-7 text-[14px] [&_svg]:h-[17px] [&_svg]:w-[17px]",
  };
  const IconEl = busy ? Loader2 : Icon;
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-heading font-medium leading-none",
        "transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.985]",
        "disabled:pointer-events-none disabled:opacity-45",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "motion-reduce:transition-none motion-reduce:active:scale-100",
        variants[variant],
        sizes[size],
        block && "w-full",
        className,
      )}
      {...props}
    >
      {IconEl && <IconEl className={cn("shrink-0", busy && "animate-spin")} aria-hidden="true" />}
      {children}
    </button>
  );
}

/** A quiet, text-only control (sidebar sign-out, pin, expander toggles). */
export function IconButton({
  className,
  icon: Icon,
  label,
  active = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center rounded-sm p-1 transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active ? "text-accent-400" : "text-neutral-600 hover:text-accent-400",
        className,
      )}
      {...props}
    >
      <Icon className="h-[15px] w-[15px]" aria-hidden="true" />
    </button>
  );
}

// ---------- Forms ----------
export const inputClass =
  "w-full min-h-9 rounded-md border border-divider bg-surface px-2.5 py-1.5 text-[13.5px] text-text caret-accent " +
  "placeholder:text-neutral-600 transition-colors duration-150 hover:border-neutral-600 " +
  "focus-visible:border-accent focus-visible:outline-none disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputClass, className)} {...props} />;
  },
);

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputClass, "pr-8", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-[5px]", className)}>
      <label htmlFor={htmlFor} className="text-[12px] text-neutral-400">
        {label}
      </label>
      {children}
      {hint && <span className="text-[11.5px] text-neutral-500">{hint}</span>}
    </div>
  );
}

// ---------- Segmented control ----------
/** Bordered strip of options; the active one sits on accent-800. */
export function Seg<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: LucideIcon }[];
  size?: "xs" | "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  const sz = {
    xs: "px-[9px] py-[3px] text-[11px]",
    sm: "px-3 py-1 text-[12px]",
    md: "px-3.5 py-[5px] text-[12.5px]",
  }[size];
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex gap-0.5 rounded-sm border border-divider bg-surface p-0.5", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[3px] transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              sz,
              on ? "bg-accent-800 text-accent-300" : "text-neutral-500 hover:text-text",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Larger option cards (choose one of N ways to run something). */
export function ChoiceCard({
  active,
  icon: Icon,
  label,
  note,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active: boolean;
  icon?: LucideIcon;
  label: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "flex flex-1 flex-col gap-1 rounded-md border px-[13px] py-[11px] text-left transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active ? "border-accent-600 bg-accent-900 text-text" : "border-divider bg-bg text-neutral-400 hover:border-neutral-600",
        className,
      )}
      {...props}
    >
      <span className="flex items-center gap-2 text-[13px]">
        {Icon && <Icon className={cn("h-[15px] w-[15px]", active ? "text-accent-400" : "text-neutral-600")} aria-hidden="true" />}
        {label}
      </span>
      {note && <span className="text-[11.5px] leading-[1.45] text-neutral-500">{note}</span>}
    </button>
  );
}

/** Round chip toggles (sensor picker). */
export function Chip({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-[12px] transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active ? "border-accent-600 bg-accent-900 text-accent-300" : "border-divider bg-surface text-neutral-400 hover:border-neutral-600",
        className,
      )}
      {...props}
    />
  );
}

// ---------- Pills ----------
// The app's status idiom: a small bordered pill whose color carries meaning.
//   verified / inherited / candidate / standard — the four sensor states
//   ok / warn / stop / info — severity and outcome
//   accent — "yours" (entered by you, open case)
export type PillVariant =
  | "verified"
  | "inherited"
  | "candidate"
  | "standard"
  | "ok"
  | "warn"
  | "stop"
  | "info"
  | "accent";
const PILL: Record<PillVariant, string> = {
  verified: "border-accent-700 bg-accent-900 text-accent-300",
  inherited: "border-neutral-700 bg-neutral-900 text-neutral-400",
  candidate: "border-dashed border-accent-600 bg-transparent text-accent-2-400",
  standard: "border-neutral-800 bg-transparent text-neutral-500",
  ok: "border-ok-line bg-ok-bg text-ok",
  warn: "border-warn-line bg-warn-bg text-warn",
  stop: "border-stop-line bg-stop-bg text-stop",
  info: "border-neutral-700 bg-neutral-900 text-neutral-400",
  accent: "border-accent-700 bg-accent-900 text-accent-300",
};
export function Pill({
  variant = "info",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: PillVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-[9px] py-[2px] text-[10.5px] leading-[1.4]",
        PILL[variant],
        className,
      )}
      {...props}
    />
  );
}

/** Compatibility shim for the pre-redesign `Badge` — same idea as Pill. */
export function Badge({
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "ok" | "warn" | "error" | "muted" }) {
  const map = { default: "accent", ok: "ok", warn: "warn", error: "stop", muted: "info" } as const;
  return <Pill variant={map[variant]} {...props} />;
}

/** Small pulsing dot for "live"/"connected". */
export function Dot({
  tone = "ok",
  pulse = false,
  glow = false,
  className,
}: {
  tone?: "ok" | "accent" | "muted" | "warn";
  pulse?: boolean;
  glow?: boolean;
  className?: string;
}) {
  const bg = { ok: "bg-ok", accent: "bg-accent", muted: "bg-neutral-600", warn: "bg-warn" }[tone];
  const ring = { ok: "shadow-[0_0_0_3px_var(--ok-bg)]", accent: "shadow-[0_0_0_3px_var(--accent-800)]", muted: "", warn: "shadow-[0_0_0_3px_var(--warn-bg)]" }[tone];
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", bg, pulse && "animate-pulse", glow && ring, className)}
    />
  );
}

/** The "this car · live" chip on the page header. */
export function LiveChip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-full border border-divider bg-surface px-[13px] py-[5px] text-[12px] shadow-sm">
      <Dot tone="accent" pulse />
      <span>{children}</span>
    </div>
  );
}

// ---------- Progress ----------
export function ProgressBar({
  value,
  tone = "accent",
  height = 3,
  className,
}: {
  /** 0–100 */
  value: number;
  tone?: "accent" | "candidate" | "gradient";
  height?: 2 | 3 | 6;
  className?: string;
}) {
  const fill = {
    accent: "bg-accent-400",
    candidate: "bg-accent-600",
    gradient: "bg-gradient-to-r from-accent-500 to-accent-400",
  }[tone];
  const h = { 2: "h-0.5", 3: "h-[3px]", 6: "h-1.5" }[height];
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-neutral-900", h, className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("rounded-full transition-[width] duration-[900ms] ease-out", h, fill)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/** A 2px indeterminate sweep (a report being written). */
export function SweepBar({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-sweep h-0.5 rounded-full bg-[length:220%_100%] bg-gradient-to-r from-accent-800 via-accent to-accent-800",
        className,
      )}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-[15px] w-[15px] animate-spin", className)} aria-hidden="true" />;
}

// ---------- Empty state ----------
export function EmptyState({
  icon: Icon,
  title,
  body,
  tone = "accent",
  action,
  className,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  body?: React.ReactNode;
  tone?: "accent" | "ok" | "muted";
  action?: React.ReactNode;
  className?: string;
}) {
  const color = { accent: "text-accent-600", ok: "text-ok", muted: "text-neutral-600" }[tone];
  return (
    <div className={cn("flex flex-col items-center gap-2 px-[17px] py-[26px] text-center", className)}>
      <Icon className={cn("h-[26px] w-[26px]", color)} aria-hidden="true" />
      <span className="text-[13.5px]">{title}</span>
      {body && <span className="max-w-[46ch] text-[12.5px] leading-[1.55] text-neutral-500">{body}</span>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// ---------- Banner ----------
export function Banner({
  tone = "warn",
  icon: Icon,
  children,
  action,
  className,
}: {
  tone?: "warn" | "stop" | "ok" | "info";
  icon?: LucideIcon;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = {
    warn: "bg-warn-bg border-warn-line text-warn",
    stop: "bg-stop-bg border-stop-line text-stop",
    ok: "bg-ok-bg border-ok-line text-ok",
    info: "bg-neutral-900 border-neutral-700 text-neutral-400",
  }[tone];
  return (
    <div role="status" className={cn("flex items-center gap-2.5 border px-[17px] py-[9px] text-[12.5px]", t, className)}>
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}

// ---------- Table ----------
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-[12.5px]", className)} {...props} />
    </div>
  );
}
export function Th({ className, align, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-divider px-[17px] py-2 text-[11px] font-normal uppercase tracking-[0.08em] text-neutral-500",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}
export function Td({ className, align, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("border-b border-neutral-900 px-[17px] py-2 align-middle", align === "right" && "text-right", className)}
      {...props}
    />
  );
}
export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-text/[0.03]", className)} {...props} />;
}

// ---------- Expander row ----------
/** A clickable row with a caret; pair with <Reveal when={open}> for the body. */
export function ExpanderButton({
  open,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { open: boolean }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      className={cn(
        "inline-flex items-center gap-[7px] text-[12.5px] text-neutral-500 transition-colors hover:text-accent-400",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ---------- Dialog ----------
export function Dialog({
  open,
  onClose,
  title,
  icon: Icon,
  iconTone = "warn",
  children,
  actions,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  icon?: LucideIcon;
  iconTone?: "warn" | "stop" | "accent";
  children: React.ReactNode;
  actions?: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const color = { warn: "text-warn", stop: "text-stop", accent: "text-accent-400" }[iconTone];
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] grid place-items-center bg-neutral-900/50 p-4"
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={backdropVariants}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className="flex flex-col gap-[13px] rounded-lg bg-surface p-4 shadow-lg"
            style={{ width: `min(${width}px, 100%)` }}
            variants={modalPanelVariants}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5">
              {Icon && <Icon className={cn("h-[19px] w-[19px]", color)} aria-hidden="true" />}
              <h2 className="text-[16px]">{title}</h2>
            </div>
            {children}
            {actions && <div className="mt-1 flex justify-end gap-2">{actions}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------- Tabs (underline style, for report "For you / For the workshop") ----------
export function UnderlineTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
}) {
  return (
    <div role="tablist" className="flex gap-0.5 border-b border-divider">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "-mb-px border-b-2 px-[13px] py-[7px] text-[12.5px] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              on ? "border-accent text-text" : "border-transparent text-neutral-500 hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Legacy shims (pre-redesign call sites) ----------
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-[13.5px]", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-2", className)} {...props} />;
}
export function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return <Seg {...props} />;
}

// ---------- success/pending feedback helpers ----------
/** Flips a label on for `ms`, then clears it — the app's one success idiom
 * ("Saved"/"Copied"), reused instead of a toast system. */
export function useTransientLabel(ms = 2000) {
  const [label, setLabel] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const flash = useCallback(
    (value: string) => {
      setLabel(value);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setLabel(null), ms);
    },
    [ms],
  );
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  return [label, flash] as const;
}

/** Cycles through a present-tense phrase list while `active` is true, so a
 * long wait reads as moving forward instead of frozen on one label. Pass a
 * module-level constant array for `phrases`. */
export function useCyclingLabel(phrases: readonly string[], active: boolean, intervalMs = 3000): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) {
      setI(0);
      return;
    }
    const id = window.setInterval(() => setI((n) => (n + 1) % phrases.length), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs, phrases]);
  return phrases[i] ?? phrases[0];
}
