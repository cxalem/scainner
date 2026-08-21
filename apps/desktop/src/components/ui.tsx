// Minimal shadcn-style primitives (hand-rolled, no CLI): Card, Button, Badge, Tabs.
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// ---------- Card ----------
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-4 pb-2", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm font-medium text-muted-foreground", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-0", className)} {...props} />;
}

// ---------- Skeleton ----------
// Reuses the app's one existing skeleton language (animate-pulse + bg-muted,
// already used by the two Suspense boundaries) everywhere a query is
// isPending, instead of blank space or a "loading…" string.
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

/** A Card-shaped loading placeholder, sized to match the content it stands
 * in for so nothing shifts once real data lands (engineering.md rule 5).
 * Pass `rows` for a simple label/value list shape, or `contentClassName`
 * (e.g. "h-44") for a chart- or table-shaped card that fills one block. */
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
      {title && (
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
      )}
      <CardContent className={contentClassName ? undefined : "flex flex-col gap-2"}>
        {contentClassName ? (
          <Skeleton className={cn("w-full", contentClassName)} />
        ) : (
          Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Button ----------
type ButtonVariant = "default" | "outline" | "destructive" | "ghost";
export function Button({
  className,
  variant = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variants: Record<ButtonVariant, string> = {
    default: "bg-primary text-primary-foreground hover:opacity-90",
    outline: "border border-border bg-transparent hover:bg-muted",
    destructive: "bg-destructive text-white hover:opacity-90",
    ghost: "hover:bg-muted",
  };
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium",
        "transition-[color,background-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        "disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

// ---------- Segmented control ----------
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div role="group" className={cn("inline-flex items-center gap-1 rounded-lg bg-muted p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium",
            "transition-[color,background-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            value === o.value ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Badge ----------
// Dot + plain text, no filled pill — replaces the soft-tinted-pill look
// (bg-primary/15 text-primary, rounded-full) that read as generic/AI-
// templated (Alejandro, 2026-08-21: "I don't really like this look, like
// really AI generated"). Matches the severity-dot language
// CodeGroupRow.tsx already used for individual codes — this makes that
// the one consistent status idiom everywhere instead of two different
// ones. Compared live against an outlined-chip and a solid-fill
// alternative on the actual 80-code Diagnose scan; this read as the
// clearest and the only one that stayed calm at high badge density (the
// readiness-monitor row, a dozen-plus badges at once).
type BadgeVariant = "default" | "ok" | "warn" | "error" | "muted";
export function Badge({
  className,
  variant = "default",
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  const dot: Record<BadgeVariant, string> = {
    default: "bg-primary",
    ok: "bg-primary",
    warn: "bg-warn",
    error: "bg-destructive",
    muted: "bg-muted-foreground",
  };
  const text: Record<BadgeVariant, string> = {
    default: "text-foreground",
    ok: "text-foreground",
    warn: "text-warn",
    error: "text-destructive",
    muted: "text-muted-foreground",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", text[variant], className)} {...props}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot[variant])} aria-hidden="true" />
      {children}
    </span>
  );
}

// ---------- Tabs ----------
const TabsCtx = React.createContext<{ value: string; set: (v: string) => void }>({
  value: "",
  set: () => {},
});
export function Tabs({
  defaultValue,
  children,
  className,
}: {
  defaultValue: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [value, set] = React.useState(defaultValue);
  return (
    <TabsCtx.Provider value={{ value, set }}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}
export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("inline-flex items-center gap-1 rounded-lg bg-muted p-1", className)}
      {...props}
    />
  );
}
export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  const ctx = React.useContext(TabsCtx);
  const active = ctx.value === value;
  return (
    <button
      onClick={() => ctx.set(value)}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        active ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
export function TabsContent({ value, children }: { value: string; children: React.ReactNode }) {
  const ctx = React.useContext(TabsCtx);
  if (ctx.value !== value) return null;
  return <div className="mt-4">{children}</div>;
}

// ---------- success/pending feedback helpers ----------
// (interaction-audit.md rules 4 and 5/9 — shared once instead of the
// hand-rolled useState+setTimeout pattern that used to live in three places)

/** Flips a label on for `ms`, then clears it — the app's one success idiom
 * ("Saved"/"Copied" for ~2s), reused instead of a new toast system
 * (decisions-plan.md: "No toast system; reuse the transient label
 * pattern"). Call `flash("saved")` and compare `label === "saved"`; several
 * call sites in one component (e.g. two export buttons) can share one
 * instance by flashing different string values. */
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
 * long wait (connect, a full sensor sweep, an AI report) reads as moving
 * forward instead of frozen on one static label (interaction-audit.md rule
 * 3/5). Resets to the first phrase whenever `active` goes false, so the next
 * wait always starts from the beginning. Pass a module-level constant array
 * for `phrases` — a literal defined inline would re-trigger the effect on
 * every render. */
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
