import { useState } from "react";
import { Effect } from "effect";
import { useQueryClient } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ConfirmWrite } from "@/components/ConfirmWrite";
import type { ClearOutcome } from "@scainner/core";
import { useT } from "@/i18n";

// Reads and clears fault codes stored on the module itself (as opposed to
// the standard engine DTCs in Diagnose). Clearing is a real write, so it
// goes through the full safety rail: the shared ConfirmWrite modal (no more
// inline banner, which shifted layout), `confirmed: true` at the command
// boundary, and a persisted before/after row in the write history (shown in
// Diagnose). The clear is verified: read, clear, read again, so the result
// is an honest before/after instead of a blind "done" button.
export function ModuleFaults({ module, label, connected }: { module: string; label: string; connected: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [faults, setFaults] = useState<string[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [outcome, setOutcome] = useState<ClearOutcome | null>(null);

  const readFaults = async () => {
    setBusy("read");
    setError(null);
    setOutcome(null);
    try {
      setFaults(await runPromise(Effect.flatMap(DeviceService, (device) => device.udsModuleDtcs(module))));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setConfirmClear(false);
    setBusy("clear");
    setError(null);
    setOutcome(null);
    try {
      const result = await runPromise(Effect.flatMap(DeviceService, (device) => device.udsClear(module)));
      setOutcome(result);
      setFaults(result.after);
      // WriteHistory lives in a different view (Diagnose); this is what
      // makes it show this write without waiting for a fresh mount there.
      qc.invalidateQueries({ queryKey: ["writes_log"] });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.lab.moduleFaults.cardTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {t.lab.moduleFaults.explainerBefore}
          <span className="font-mono">U</span>
          {t.lab.moduleFaults.explainerAfter}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={readFaults} disabled={!connected || busy !== null}>
            <RefreshCw className={"h-4 w-4" + (busy === "read" ? " animate-spin" : "")} aria-hidden="true" />
            {busy === "read" ? t.lab.moduleFaults.reading : t.lab.moduleFaults.readFaults}
          </Button>
          {faults && faults.length > 0 && (
            <Button variant="outline" onClick={() => setConfirmClear(true)} disabled={busy !== null}>
              {busy === "clear" ? t.lab.moduleFaults.clearing : t.lab.moduleFaults.clearFaults(faults.length)}
            </Button>
          )}
        </div>

        {faults && !outcome && (
          <div className="text-sm">
            {faults.length === 0 ? (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                {t.lab.moduleFaults.noFaultsStored}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {faults.map((c) => (
                  <span key={c} className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {confirmClear && (
          <ConfirmWrite
            title={t.lab.moduleFaults.confirm.title}
            module={label}
            whatChanges={t.lab.moduleFaults.confirm.whatChanges}
            reversal={t.lab.moduleFaults.confirm.reversal}
            confirmLabel={t.lab.moduleFaults.confirm.confirmLabel}
            busyLabel={t.lab.moduleFaults.clearing}
            busy={busy !== null}
            onConfirm={clear}
            onCancel={() => setConfirmClear(false)}
          />
        )}

        {outcome && !outcome.accepted && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
            {t.lab.moduleFaults.refused}
          </p>
        )}

        {outcome && outcome.accepted && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/50 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              {outcome.after.length === 0 ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t.lab.moduleFaults.clearedVerified(outcome.before.length)}
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
                  {t.lab.moduleFaults.clearedButCameBack(outcome.before.length, outcome.after.length)}
                </>
              )}
            </p>
            {outcome.before.length > 0 && (
              <p className="font-mono text-xs text-muted-foreground">
                {t.lab.moduleFaults.was(outcome.before.join(", "))}
              </p>
            )}
            {outcome.after.length > 0 && (
              <p className="font-mono text-xs text-muted-foreground">
                {t.lab.moduleFaults.stillPresent(outcome.after.join(", "))}
              </p>
            )}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t.lab.moduleFaults.dashboardLightNote}
            </p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
