import { useState, type ReactNode } from "react";
import {
  Activity,
  Car,
  ChartLine,
  FlaskConical,
  Gauge,
  Languages,
  LayoutDashboard,
  Plug,
  PlugZap,
  Stethoscope,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_MODE } from "@/lib/tauri";
import { useCyclingLabel } from "@/components/ui";
import { UpdateBanner } from "@/components/UpdateBanner";
import type { ConnStatus } from "@scainner/core";
import { useLocale, useT, type Locale } from "@/i18n";

export type ViewKey = "overview" | "live" | "history" | "diagnose" | "lab" | "vehicle";

export function Shell({
  view,
  onNavigate,
  conn,
  recording,
  onConnect,
  onDisconnect,
  children,
}: {
  view: ViewKey;
  onNavigate: (v: ViewKey) => void;
  conn: ConnStatus;
  recording: boolean;
  onConnect: () => void;
  onDisconnect: () => Promise<unknown>;
  children: ReactNode;
}) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const connected = conn.state === "connected";
  const connecting = conn.state === "connecting";
  const connectLabel = useCyclingLabel(t.shell.connectPhrases, connecting, 700);
  // No "disconnecting" ConnStatus state exists on the backend, so this is
  // local, sync-tracked purely to give Disconnect the pending feedback it
  // has none of today (interaction-audit.md worst offender list).
  const [disconnecting, setDisconnecting] = useState(false);
  const doDisconnect = async () => {
    setDisconnecting(true);
    try {
      await onDisconnect();
    } finally {
      setDisconnecting(false);
    }
  };

  const NAV: { key: ViewKey; label: string; icon: typeof Activity; advanced?: boolean }[] = [
    { key: "overview", label: t.shell.nav.overview, icon: LayoutDashboard },
    { key: "live", label: t.shell.nav.live, icon: Activity },
    { key: "history", label: t.shell.nav.history, icon: ChartLine },
    { key: "diagnose", label: t.shell.nav.diagnose, icon: Stethoscope },
    { key: "lab", label: t.shell.nav.lab, icon: FlaskConical, advanced: true },
    { key: "vehicle", label: t.shell.nav.vehicle, icon: Car, advanced: true },
  ];
  const primary = NAV.filter((n) => !n.advanced);
  const advanced = NAV.filter((n) => n.advanced);

  const item = (n: (typeof NAV)[number]) => {
    const Icon = n.icon;
    const active = view === n.key;
    return (
      <button
        key={n.key}
        onClick={() => onNavigate(n.key)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm font-medium",
          "transition-[color,background-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {n.label}
      </button>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border p-3">
        <div className="mb-4 flex items-center gap-2 px-2 pt-1">
          <Gauge className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">{t.shell.appName}</span>
          {MOCK_MODE && (
            <span
              className="ml-auto rounded-full bg-warn/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn"
              title={t.shell.demoDataTooltip}
            >
              {t.shell.demoData}
            </span>
          )}
        </div>

        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {primary.map(item)}
          <div className="mx-2 my-2 border-t border-border" role="separator" />
          {advanced.map(item)}
        </nav>

        {/* mt-auto on this wrapper, not the connection card alone — adding
            the locale toggle above the card had bumped the card's own
            mt-auto to mt-2, which un-pinned it from the sidebar's bottom
            (Alejandro, 2026-08-21: "the connection disconnect part is now
            not at the bottom... it should be there"). Grouping both under
            one mt-auto keeps the toggle directly above the card, and pins
            the pair together at the bottom, same as before the toggle
            existed. */}
        <div className="mt-auto flex flex-col gap-2">
          {/* Locale toggle: lives here rather than a Settings view (there
              isn't one yet) — see docs/workflows/i18n/plan.md. Cheap to
              move once a real Settings view exists. */}
          <div className="flex items-center gap-1.5 px-2">
            <Languages className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div role="group" aria-label={t.shell.language} className="flex items-center gap-1">
              {(["en", "es"] as Locale[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setLocale(option)}
                  aria-pressed={locale === option}
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-xs font-medium uppercase transition-colors",
                    locale === option ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  connected ? "bg-primary" : connecting ? "animate-pulse bg-warn" : "bg-muted-foreground/40"
                )}
              />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {connected ? t.shell.status.connected : connecting ? t.shell.status.connecting : t.shell.status.disconnected}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {connected && recording
                    ? t.shell.status.recording
                    : connected
                      ? conn.elm_version ?? t.shell.status.linkUp
                      : connecting
                        ? t.shell.status.wakingDongle
                        : t.shell.status.ignitionThenConnect}
                </p>
              </div>
            </div>
            {connected ? (
              <button
                onClick={doDisconnect}
                disabled={disconnecting}
                className={cn(
                  "flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border text-xs font-medium",
                  "transition-[color,background-color,transform] duration-150 hover:bg-muted active:scale-[0.98]",
                  "disabled:pointer-events-none disabled:opacity-50",
                  "motion-reduce:transition-none motion-reduce:active:scale-100",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                )}
              >
                <Plug className="h-3.5 w-3.5" aria-hidden="true" /> {disconnecting ? t.shell.disconnecting : t.shell.disconnect}
              </button>
            ) : (
              <button
                onClick={onConnect}
                disabled={connecting}
                className={cn(
                  "flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-medium text-primary-foreground",
                  "transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98]",
                  "disabled:opacity-50 disabled:pointer-events-none",
                  "motion-reduce:transition-none motion-reduce:active:scale-100",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                )}
              >
                <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />
                {connecting ? connectLabel : t.shell.connect}
              </button>
            )}
            {conn.detail && conn.state === "disconnected" && (
              <p className="mt-2 text-xs leading-snug text-destructive">{conn.detail}</p>
            )}
          </div>
        </div>
      </aside>

      {/* overflow-y-scroll (not -auto): every page renders through here, so
          this is the "content shifts left all over the place" bug
          (Alejandro, 2026-08-21) — auto only reserves the scrollbar gutter
          once a page's content actually overflows the viewport, so the
          instant it does everything shifts. Same fix DiscoveryFlow.tsx
          already applied to its own scroll area, just at the app-wide
          level this time. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <UpdateBanner />
        <div className="min-h-0 flex-1 overflow-y-scroll">
          <div className="mx-auto max-w-4xl p-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
