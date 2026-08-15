// Minimal shadcn-style primitives (hand-rolled, no CLI): Card, Button, Badge, Tabs.
import * as React from "react";
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
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
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
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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
type BadgeVariant = "default" | "ok" | "warn" | "error" | "muted";
export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  const variants: Record<BadgeVariant, string> = {
    default: "bg-primary/15 text-primary",
    ok: "bg-primary/15 text-primary",
    warn: "bg-warn/20 text-warn",
    error: "bg-destructive/15 text-destructive",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
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
