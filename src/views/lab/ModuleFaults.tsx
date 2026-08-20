import { useState } from "react";
import { invoke } from "@/lib/tauri";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

type ClearOutcome = { before: string[]; accepted: boolean; after: string[] };

/// Reads and clears fault codes stored on the module itself (as opposed to
/// the standard engine DTCs in Diagnose). Clearing is verified: read →
/// clear → read again, so the result is an honest before/after instead of a
/// blind "done" button.
export function ModuleFaults({ module, connected }: { module: string; connected: boolean }) {
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
      setFaults(await invoke<string[]>("uds_module_dtcs", { module }));
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
      const result = await invoke<ClearOutcome>("uds_clear", { module });
      setOutcome(result);
      setFaults(result.after);
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
          communication faults — scans routinely leave these behind (the module goes quiet while answering us, and
          its neighbours log "lost contact"). They are harmless and expected.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={readFaults} disabled={!connected || busy !== null}>
            <RefreshCw className={"h-4 w-4" + (busy === "read" ? " animate-spin" : "")} aria-hidden="true" />
            {busy === "read" ? "Reading…" : "Read faults"}
          </Button>
          {faults && faults.length > 0 && !confirmClear && (
            <Button variant="outline" onClick={() => setConfirmClear(true)} disabled={busy !== null}>
              Clear {faults.length} fault{faults.length === 1 ? "" : "s"}…
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
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
            <span>Erase all stored codes on this module? The app verifies the result afterwards.</span>
            <Button variant="destructive" onClick={clear} disabled={busy !== null}>
              {busy === "clear" ? "Clearing…" : "Yes, clear"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
          </div>
        )}

        {outcome && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/50 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              {outcome.after.length === 0 ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  Cleared and verified — {outcome.before.length || "no"} fault
                  {outcome.before.length === 1 ? "" : "s"} before, none remaining.
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
                  Cleared {outcome.before.length}, but {outcome.after.length} came straight back — those are active
                  faults, not leftovers. Worth investigating.
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
              by itself after an ignition cycle — engine off, wait a minute, start again. No further action needed.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
