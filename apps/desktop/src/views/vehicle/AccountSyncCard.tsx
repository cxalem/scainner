// Account + cloud sync: sign in with an emailed one-time code (no password,
// no browser redirect — the right OTP shape for a desktop app), then the
// sync engine (lib/sync.ts) pushes the local record up under this user's
// JWT with RLS deciding every row. Lives in the Vehicle tab next to the
// other data/export concerns until a real Settings surface exists.
import { useEffect, useState, useSyncExternalStore } from "react";
import { CloudUpload, LogOut, UserRound } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { getSyncStatus, requestSync, subscribeSyncStatus } from "@/lib/sync";
import { useT } from "@/i18n";

const inputCls =
  "h-9 rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function AccountSyncCard() {
  const t = useT();
  const sync = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setUserEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const sendCode = async () => {
    setBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) setAuthError(error.message);
    else setStep("code");
  };

  const verify = async () => {
    setBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setAuthError(error.message);
    else {
      setStep("email");
      setCode("");
      requestSync();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <CloudUpload className="h-4 w-4" aria-hidden="true" /> {t.vehicle.account.cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {userEmail == null ? (
          <>
            <p className="text-muted-foreground">{t.vehicle.account.explainer}</p>
            {step === "email" ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={t.vehicle.account.emailLabel}
                  type="email"
                  inputMode="email"
                  className={inputCls + " w-64"}
                  placeholder={t.vehicle.account.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Button onClick={() => void sendCode()} disabled={busy || !email.includes("@")}>
                  {busy ? t.vehicle.account.sendingCode : t.vehicle.account.sendCode}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground">{t.vehicle.account.codeSentTo(email.trim())}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={t.vehicle.account.codeLabel}
                    inputMode="numeric"
                    className={inputCls + " w-32 font-mono tracking-widest"}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                  <Button onClick={() => void verify()} disabled={busy || code.length < 6}>
                    {busy ? t.vehicle.account.verifying : t.vehicle.account.verify}
                  </Button>
                  <Button variant="ghost" onClick={() => setStep("email")} disabled={busy}>
                    {t.common.cancel}
                  </Button>
                </div>
              </div>
            )}
            {authError && <p className="text-destructive">{authError}</p>}
          </>
        ) : (
          <>
            <p className="flex items-center gap-1.5">
              <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t.vehicle.account.signedInAs(userEmail)}
            </p>
            <p className="text-xs text-muted-foreground">
              {sync.phase === "syncing"
                ? t.vehicle.account.syncing
                : sync.lastSyncAt != null
                  ? t.vehicle.account.lastSync(new Date(sync.lastSyncAt).toLocaleTimeString())
                  : t.vehicle.account.neverSynced}
            </p>
            {sync.phase === "error" && sync.lastError && (
              <p className="text-xs text-destructive">
                {t.vehicle.account.syncErrorLabel} {sync.lastError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={requestSync} disabled={sync.phase === "syncing"}>
                <CloudUpload className="h-4 w-4" aria-hidden="true" />
                {sync.phase === "syncing" ? t.vehicle.account.syncing : t.vehicle.account.syncNow}
              </Button>
              <Button variant="ghost" onClick={() => void supabase.auth.signOut()}>
                <LogOut className="h-4 w-4" aria-hidden="true" /> {t.vehicle.account.signOut}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
