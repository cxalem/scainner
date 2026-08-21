// The very first thing you see, before any sidebar/nav exists: a blank
// screen with one button. Shown only until the first successful connect of
// this app session (App.tsx tracks that with hasConnectedOnce, not with
// conn.state directly) — once you've connected once, later disconnects fall
// back to the normal Shell's own "Disconnected" treatment instead of kicking
// you back out to this gate, so a brief signal drop while you're mid-review
// doesn't yank you out of what you were looking at.
import { useState } from "react";
import { Gauge, PlugZap, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_MODE } from "@/lib/tauri";
import { useCyclingLabel } from "@/components/ui";
import { useEmailOtp } from "@/features/account/useEmailOtp";
import type { ConnStatus } from "@scainner/core";
import { useT } from "@/i18n";

const gateInputCls =
  "h-9 rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

// Account access BEFORE any car is connected — the sign-in used to live
// only in the Vehicle tab, which this gate makes unreachable until the
// first connect: the owner literally could not find it (2026-08-21).
// Deliberately quiet (a text affordance, not a second big button): sign-in
// is an offer, never a requirement — connecting to the car stays the one
// primary action, and the app works fully offline without an account.
function GateAccount() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { email, setEmail, code, setCode, step, busy, authError, userEmail, sendCode, verify } = useEmailOtp();

  if (userEmail != null) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
        {t.vehicle.account.signedInAs(userEmail)}
      </p>
    );
  }
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t.shell.cloudSignInPrompt}
      </button>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2">
      {step === "email" ? (
        <div className="flex items-center gap-2">
          <input
            aria-label={t.vehicle.account.emailLabel}
            type="email"
            inputMode="email"
            className={gateInputCls + " w-56"}
            placeholder={t.vehicle.account.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            onClick={() => void sendCode()}
            disabled={busy || !email.includes("@")}
            className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {busy ? t.vehicle.account.sendingCode : t.vehicle.account.sendCode}
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t.vehicle.account.codeSentTo(email.trim())}</p>
          <div className="flex items-center gap-2">
            <input
              aria-label={t.vehicle.account.codeLabel}
              inputMode="numeric"
              className={gateInputCls + " w-28 font-mono tracking-widest"}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button
              onClick={() => void verify()}
              disabled={busy || code.length < 6}
              className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {busy ? t.vehicle.account.verifying : t.vehicle.account.verify}
            </button>
          </div>
        </>
      )}
      {authError && <p className="max-w-xs text-xs text-destructive">{authError}</p>}
    </div>
  );
}

export function ConnectGate({ conn, onConnect }: { conn: ConnStatus; onConnect: () => void }) {
  const t = useT();
  const connecting = conn.state === "connecting";
  const connectLabel = useCyclingLabel(t.shell.connectPhrases, connecting, 700);

  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      {MOCK_MODE && (
        <span className="absolute right-4 top-4 rounded-full bg-warn/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn">
          {t.shell.demoData}
        </span>
      )}
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex items-center gap-2">
          <Gauge className="h-6 w-6 text-primary" aria-hidden="true" />
          <span className="text-lg font-semibold tracking-tight">{t.shell.appName}</span>
        </div>
        <button
          onClick={onConnect}
          disabled={connecting}
          className={cn(
            "flex h-12 items-center gap-2 rounded-full bg-primary px-8 text-sm font-medium text-primary-foreground",
            "transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98]",
            "disabled:opacity-50 disabled:pointer-events-none",
            "motion-reduce:transition-none motion-reduce:active:scale-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <PlugZap className="h-4 w-4" aria-hidden="true" />
          {connecting ? connectLabel : t.shell.connect}
        </button>
        <p className="text-xs text-muted-foreground">{t.shell.status.ignitionThenConnect}</p>
        {conn.detail && conn.state === "disconnected" && (
          <p className="max-w-xs text-xs leading-snug text-destructive">{conn.detail}</p>
        )}
        <GateAccount />
      </div>
    </div>
  );
}
