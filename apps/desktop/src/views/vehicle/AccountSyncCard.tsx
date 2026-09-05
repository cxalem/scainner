import { useEffect, useState, useSyncExternalStore } from "react";
import { CloudUpload, Sparkles } from "lucide-react";
import { Button, Card, CardHead, Dot, Field, Input, Note } from "@/components/ui";
import { Swap } from "@/motion/components";
import { useEmailOtp } from "@/features/account/useEmailOtp";
import { getSyncStatus, requestSync, subscribeSyncStatus } from "@/lib/sync";
import { invoke } from "@/lib/tauri";
import { useT } from "@/i18n";
import { usePricing } from "@/features/reports/queries";
import { BillingDialog } from "@/components/BillingDialog";

export function AccountSyncCard() {
  const t = useT();
  const sync = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const { email, setEmail, code, setCode, step, setStep, busy, authError, userEmail, sendCode, verify, signOut } = useEmailOtp();
  const a = t.vehicle.account;
  const [contributeKnowledge, setContributeKnowledge] = useState(true);
  const [billingOpen, setBillingOpen] = useState(false);
  const pricing = usePricing();

  useEffect(() => {
    void invoke<string | null>("app_setting_get", { key: "contribute_knowledge" }).then((value) => {
      setContributeKnowledge(value !== "false");
    });
  }, []);

  const updateContribution = (enabled: boolean) => {
    setContributeKnowledge(enabled);
    void invoke<void>("app_setting_set", {
      key: "contribute_knowledge",
      value: String(enabled),
    });
  };

  return (
    <Card className="gap-[11px]">
      <CardHead icon={CloudUpload} title={a.syncTitle} />
      <label className="flex items-start gap-2.5 text-[12px] leading-[1.5] text-neutral-300">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={contributeKnowledge}
          onChange={(event) => updateContribution(event.target.checked)}
        />
        <span>{a.contributeKnowledge}</span>
      </label>
      <Swap k={userEmail == null ? step : "in"} className="flex flex-col gap-[9px]">
        {userEmail == null ? (
          step === "email" ? (
            <form
              className="flex flex-col gap-[9px]"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && email.includes("@")) void sendCode();
              }}
            >
              <Note className="text-[12px]">{a.explainer}</Note>
              <Field label={a.emailLabel} htmlFor="acct-email">
                <Input id="acct-email" type="email" inputMode="email" placeholder={a.emailPlaceholder} value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <div>
                <Button type="submit" size="sm" variant="primary" busy={busy} disabled={busy || !email.includes("@")}>
                  {busy ? a.sendingCode : a.sendCode}
                </Button>
              </div>
            </form>
          ) : (
            <form
              className="flex flex-col gap-[9px]"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && code.length >= 6) void verify();
              }}
            >
              <Note className="text-[12px]">{a.codeSentTo(email.trim())}</Note>
              <Field label={a.codeLabel} htmlFor="acct-code">
                <Input
                  id="acct-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="num tracking-[0.3em]"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </Field>
              <div className="flex gap-[7px]">
                <Button type="submit" size="sm" variant="primary" busy={busy} disabled={busy || code.length < 6}>
                  {busy ? a.verifying : a.verify}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setStep("email")} disabled={busy}>
                  {t.common.cancel}
                </Button>
              </div>
            </form>
          )
        ) : (
          <>
            <div className="flex items-center gap-[9px] text-[12.5px]">
              <Dot tone="ok" />
              <span className="flex-1 text-neutral-300">{a.signedInAs(userEmail)}</span>
            </div>
            <Note className="text-[12px]">
              {sync.phase === "syncing"
                ? a.syncing
                : sync.lastSyncAt != null
                  ? a.lastSync(new Date(sync.lastSyncAt).toLocaleTimeString())
                  : a.neverSynced}{" "}
              {a.syncedNote}
            </Note>
            <div className="rounded-md bg-accent-900 p-3 text-[12.5px]">
              <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent-400" aria-hidden="true" /><span className="font-medium">{pricing.data?.account?.balance ?? 0} {t.vehicle.account.reportCredits}</span></div>
              {pricing.data?.account?.subscription && <p className="mt-1 text-neutral-500">{t.vehicle.account.subscriptionState(pricing.data.account.subscription.allowance_used, pricing.data.account.subscription.monthly_allowance)}</p>}
            </div>
            {sync.phase === "error" && sync.lastError && (
              <Note className="text-[12px] text-stop">
                {a.syncErrorLabel} {sync.lastError}
              </Note>
            )}
            <div className="flex gap-[7px]">
              <Button size="sm" onClick={requestSync} busy={sync.phase === "syncing"}>
                {sync.phase === "syncing" ? a.syncing : a.syncNow}
              </Button>
              <Button size="sm" variant="ghost" onClick={signOut}>
                {a.signOut}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setBillingOpen(true)}>{a.buyReports}</Button>
            </div>
          </>
        )}
      </Swap>
      {authError && <Note className="text-[12px] text-stop">{authError}</Note>}
      <BillingDialog open={billingOpen} onOpenChange={setBillingOpen} />
    </Card>
  );
}
