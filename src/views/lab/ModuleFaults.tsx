import { useState } from "react";
import { Effect } from "effect";
import { useQueryClient } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@/core/services/device-service";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ConfirmWrite } from "@/components/ConfirmWrite";
import type { ClearOutcome } from "@/features/lab/schema";

// Reads and clears fault codes stored on the module itself (as opposed to
// the standard engine DTCs in Diagnose). Clearing is a real write, so it
// goes through the full safety rail: the shared ConfirmWrite modal (no more
// inline banner, which shifted layout), `confirmed: true` at the command
// boundary, and a persisted before/after row in the write history (shown in
// Diagnose). The clear is verified: read, clear, read again, so the result
// is an honest before/after instead of a blind "done" button.
export function ModuleFaults({ module, label, connected }: { module: string; label: string; connected: boolean }) {
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
      setFaults(await runPromise(Effect.flatMap(DeviceService, (s) => s.udsModuleDtcs(module))));
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
      const result = await runPromise(Effect.flatMap(DeviceService, (s) => s.udsClear(module)));
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
        <CardTitle>Module faults</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Faults stored on the selected module itself. Codes starting with <span className="font-mono">U</span> are
          communication faults, and scans routinely leave these behind (the module goes quiet while answering us, and
          its neighbours log "lost contact"). They are harmless and expected.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={readFaults} disabled={!connected || busy !== null}>
            <RefreshCw className={"h-4 w-4" + (busy === "read" ? " animate-spin" : "")} aria-hidden="true" />
            {busy === "read" ? "Reading…" : "Read faults"}
          </Button>
          {faults && faults.length > 0 && (
            <Button variant="outline" onClick={() => setConfirmClear(true)} disabled={busy !== null}>
              {busy === "clear" ? "Clearing…" : `Clear ${faults.length} fault${faults.length === 1 ? "" : "s"}…`}
            </Button>
          )}
        </div>

        {faults && !outcome && (
          <div className="text-sm">
            {faults.length === 0 ? (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                No faults stored on this module.
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
            title="Clear module faults?"
            module={label}
            whatChanges="This erases every fault code stored on this module. The app reads the module again right after, so the result is verified, and the write is saved to the write history in Diagnose."
            reversal="No. Erased codes cannot be put back. This is still safe to do: the codes just read are saved in the write history, and a fault that is still present will report itself again on its own."
            confirmLabel="Yes, clear"
            busyLabel="Clearing…"
            busy={busy !== null}
            onConfirm={clear}
            onCancel={() => setConfirmClear(false)}
          />
        )}

        {outcome && !outcome.accepted && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
            The module refused the clear command. Nothing was changed.
          </p>
        )}

        {outcome && outcome.accepted && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/50 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              {outcome.after.length === 0 ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  Cleared and verified: {outcome.before.length || "no"} fault
                  {outcome.before.length === 1 ? "" : "s"} before, none remaining.
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
                  Cleared {outcome.before.length}, but {outcome.after.length} came straight back. Those are active
                  faults, not leftovers, and worth investigating.
                </>
              )}
            </p>
            {outcome.before.length > 0 && (
              <p className="font-mono text-xs text-muted-foreground">was: {outcome.before.join(", ")}</p>
            )}
            {outcome.after.length > 0 && (
              <p className="font-mono text-xs text-muted-foreground">still: {outcome.after.join(", ")}</p>
            )}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              If a dashboard light is still on: it lives on modules this dongle can't reach (BSI/cluster) and clears
              by itself after an ignition cycle. Engine off, wait a minute, start again. No further action needed.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
