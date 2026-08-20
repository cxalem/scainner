// The very first thing you see, before any sidebar/nav exists: a blank
// screen with one button. Shown only until the first successful connect of
// this app session (App.tsx tracks that with hasConnectedOnce, not with
// conn.state directly) — once you've connected once, later disconnects fall
// back to the normal Shell's own "Disconnected" treatment instead of kicking
// you back out to this gate, so a brief signal drop while you're mid-review
// doesn't yank you out of what you were looking at.
import { Gauge, PlugZap } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_MODE } from "@/lib/tauri";
import type { ConnStatus } from "@/lib/meta";

export function ConnectGate({ conn, onConnect }: { conn: ConnStatus; onConnect: () => void }) {
  const connecting = conn.state === "connecting";

  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      {MOCK_MODE && (
        <span className="absolute right-4 top-4 rounded-full bg-warn/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn">
          Demo data
        </span>
      )}
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex items-center gap-2">
          <Gauge className="h-6 w-6 text-primary" aria-hidden="true" />
          <span className="text-lg font-semibold tracking-tight">Scainner</span>
        </div>
        <button
          onClick={onConnect}
          disabled={connecting}
          className={cn(
            "flex h-12 items-center gap-2 rounded-full bg-primary px-8 text-sm font-medium text-primary-foreground",
            "transition-opacity hover:opacity-90 disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <PlugZap className="h-4 w-4" aria-hidden="true" />
          {connecting ? "Connecting…" : "Connect"}
        </button>
        <p className="text-xs text-muted-foreground">Ignition on, then connect.</p>
        {conn.detail && conn.state === "disconnected" && (
          <p className="max-w-xs text-xs leading-snug text-destructive">{conn.detail}</p>
        )}
      </div>
    </div>
  );
}
