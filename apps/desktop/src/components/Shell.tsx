import { useState, type ReactNode } from "react";
import {
  Activity,
  Car,
  ChartLine,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Plug,
  PlugZap,
  Stethoscope,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_MODE } from "@/lib/tauri";
import { useCyclingLabel } from "@/components/ui";
import { CONNECT_PHRASES, type ConnStatus } from "@scainner/core";

export type ViewKey = "overview" | "live" | "history" | "diagnose" | "lab" | "vehicle";

const NAV: { key: ViewKey; label: string; icon: typeof Activity; advanced?: boolean }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "live", label: "Live", icon: Activity },
  { key: "history", label: "History", icon: ChartLine },
  { key: "diagnose", label: "Diagnose", icon: Stethoscope },
  { key: "lab", label: "Lab", icon: FlaskConical, advanced: true },
  { key: "vehicle", label: "Vehicle", icon: Car, advanced: true },
];

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
  const connected = conn.state === "connected";
  const connecting = conn.state === "connecting";
  const connectLabel = useCyclingLabel(CONNECT_PHRASES, connecting, 700);
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
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border p-3">
        <div className="mb-4 flex items-center gap-2 px-2 pt-1">
          <Gauge className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">Scainner</span>
          {MOCK_MODE && (
            <span
              className="ml-auto rounded-full bg-warn/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn"
              title="No Tauri backend detected — showing simulated data for UI preview"
            >
              Demo data
            </span>
          )}
        </div>

        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {primary.map(item)}
          <div className="mx-2 my-2 border-t border-border" role="separator" />
          {advanced.map(item)}
        </nav>

        <div className="mt-auto rounded-lg border border-border bg-card p-3">
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
                {connected ? "Connected" : connecting ? "Connecting…" : "Disconnected"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {connected && recording
                  ? "Recording"
                  : connected
                    ? conn.elm_version ?? "Link up"
                    : connecting
                      ? "Waking the dongle"
                      : "Ignition on, then connect"}
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
              <Plug className="h-3.5 w-3.5" aria-hidden="true" /> {disconnecting ? "Disconnecting…" : "Disconnect"}
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
              {connecting ? connectLabel : "Connect"}
            </button>
          )}
          {conn.detail && conn.state === "disconnected" && (
            <p className="mt-2 text-xs leading-snug text-destructive">{conn.detail}</p>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-6">{children}</div>
      </main>
    </div>
  );
}
