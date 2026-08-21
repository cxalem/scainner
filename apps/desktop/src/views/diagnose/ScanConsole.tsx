import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, useCyclingLabel } from "@/components/ui";
import type { DtcResult, ObdClearOutcome } from "@scainner/core";
import { ConfirmWrite } from "@/components/ConfirmWrite";
import { useClearDtcs, useScanDtcs } from "@/features/diagnose/queries";
import { detectVoltageCluster } from "@/lib/dtc-grouping";
import { CodeStatusSection } from "@/views/diagnose/CodeStatusSection";
import { VoltageClusterNote } from "@/views/diagnose/VoltageClusterNote";
import { FreezeFrame } from "@/views/diagnose/FreezeFrame";

// Cycled while a scan is running — same "long wait reads as moving forward"
// idiom useCyclingLabel already established elsewhere in this app, not a new
// pattern. Order roughly matches what the backend command actually does.
const SCANNING_PHRASES = ["Reading trouble codes…", "Checking readiness monitors…", "Pulling freeze frame data…"];

// A workspace box, not a card that grows: connect → scan → read the codes →
// clear → rescan → drive → rescan is the app's core loop (Alejandro,
// 2026-08-21 — "that's probably the main feature"), so it gets one
// dedicated, fixed-footprint area instead of being one card among several
// equal-weight ones. WORKSPACE_HEIGHT is fixed (min AND max) on purpose: a
// 60-code group expanding, or a scan replacing an empty state, changes what
// scrolls INSIDE this box, never how much the rest of the page moves — the
// strongest version of engineering.md rule 5 ("no layout shifts"), since
// there is nothing left to animate rather than something animated well.
const WORKSPACE_HEIGHT = "26rem";

// Owns the whole scan/clear interaction end to end (toolbar, confirm modal,
// error/cleared banners, the results workspace) so it reads as one
// self-contained console instead of a toolbar plus a separate results card
// plus banners scattered above it. `scan` is still controlled by the parent
// (Diagnose.tsx) — Pre-ITV readiness and the AI report card need the same
// value — this component only reports results upward via callbacks.
export function ScanConsole({
  connected,
  scan,
  onScanSuccess,
  onClearSuccess,
  onSelect,
}: {
  connected: boolean;
  scan: DtcResult | null;
  onScanSuccess: (scan: DtcResult, readiness: Record<string, boolean> | null) => void;
  onClearSuccess: (outcome: ObdClearOutcome) => void;
  onSelect: (code: string) => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearedBanner, setClearedBanner] = useState<{ before: number; after: number } | null>(null);

  const scanMutation = useScanDtcs();
  const clearMutation = useClearDtcs();
  const error = scanMutation.error ?? clearMutation.error;
  const cyclingLabel = useCyclingLabel(SCANNING_PHRASES, scanMutation.isPending);

  const totalCodes = scan ? scan.stored.length + scan.pending.length + scan.permanent.length : 0;
  const voltageAffected = new Set(scan ? (detectVoltageCluster(scan)?.affected ?? []) : []);

  const doScan = () => {
    scanMutation.mutate(undefined, {
      onSuccess: ({ scan: scanResult, readiness: readinessResult }) => onScanSuccess(scanResult, readinessResult),
    });
  };

  const doClear = () => {
    // The backend does the whole verified write (scan, clear, scan again)
    // and logs it to the write history; useClearDtcs sends `confirmed:
    // true` or the command refuses — part of the write safety rail.
    clearMutation.mutate(undefined, {
      onSuccess: (outcome) => {
        onClearSuccess(outcome);
        setClearedBanner({
          before: outcome.before.stored.length + outcome.before.pending.length,
          after: outcome.after.stored.length + outcome.after.pending.length,
        });
      },
      // Modal closes only once the mutation settles (success or error), not
      // on click — closing immediately would leave a destructive, chained
      // slow-hardware action with no visible owner while it ran
      // (interaction-audit.md worst offender #1).
      onSettled: () => setConfirmClear(false),
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Fault codes</CardTitle>
          <div className="flex items-center gap-2">
            <Button onClick={doScan} disabled={!connected || scanMutation.isPending}>
              <RefreshCw className={"h-4 w-4" + (scanMutation.isPending ? " animate-spin" : "")} aria-hidden="true" />
              {scanMutation.isPending ? "Scanning…" : "Scan for codes"}
            </Button>
            {/* Stays mounted while ConfirmWrite is up — hiding it shifted
                the toolbar behind the modal (no layout shifts). */}
            {scan && totalCodes > 0 && (
              <Button variant="outline" onClick={() => setConfirmClear(true)} disabled={confirmClear}>
                Clear codes…
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {String(error instanceof Error ? error.message : error)}
          </div>
        )}

        {clearedBanner && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/50 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              {clearedBanner.after === 0 ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  Cleared and verified: {clearedBanner.before || "no"} code
                  {clearedBanner.before === 1 ? "" : "s"} before, none remaining.
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
                  Cleared, but {clearedBanner.after} code{clearedBanner.after === 1 ? "" : "s"} came straight back.
                  {clearedBanner.after === 1 ? " That is an active fault" : " Those are active faults"}, not
                  leftovers, and worth investigating.
                </>
              )}
            </p>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              No ignition cycle is needed for the check-engine light. It goes off with the clear. Two things reset
              with it: readiness monitors re-run over your next few drives (relevant before an ITV), and permanent
              codes (if any) erase themselves only after the car self-verifies the fault is gone.
            </p>
          </div>
        )}
      </CardHeader>

      <CardContent>
        <div className="flex flex-col" style={{ minHeight: WORKSPACE_HEIGHT, maxHeight: WORKSPACE_HEIGHT }}>
          {scanMutation.isPending ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
              <div className="relative h-1 w-48 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 w-1/3 animate-[scan-sweep_1.4s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:animate-none"
                  aria-hidden="true"
                />
              </div>
              <p className="text-sm text-muted-foreground">{cyclingLabel}</p>
            </div>
          ) : !scan ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
              <p className="text-sm text-muted-foreground">No scan yet.</p>
              <p className="text-sm text-muted-foreground">Click "Scan for codes" to check this vehicle.</p>
            </div>
          ) : (
            <div className="animate-fade-slide-in flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
              <div className="flex items-center gap-2">
                {scan.mil_on ? (
                  <Badge variant="error">CHECK ENGINE ON · {scan.dtc_count} codes</Badge>
                ) : (
                  <Badge variant="ok">
                    <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> MIL off
                  </Badge>
                )}
                {scan.voltage != null && <Badge variant="muted">{scan.voltage.toFixed(1)} V</Badge>}
              </div>
              <VoltageClusterNote scan={scan} />
              <CodeStatusSection label="Stored" codes={scan.stored} affected={voltageAffected} onSelect={onSelect} />
              <CodeStatusSection
                label="Pending"
                codes={scan.pending}
                affected={voltageAffected}
                onSelect={onSelect}
              />
              <CodeStatusSection
                label="Permanent"
                codes={scan.permanent}
                affected={voltageAffected}
                onSelect={onSelect}
              />
              {totalCodes === 0 && <p className="text-sm text-muted-foreground">No codes on this scan.</p>}
              <p className="text-xs text-muted-foreground">
                Click any code for details, its history, and an AI deep-dive.
              </p>
              {scan.freeze && <FreezeFrame data={scan.freeze as Record<string, unknown>} />}
            </div>
          )}
        </div>
      </CardContent>

      {confirmClear && (
        <ConfirmWrite
          title="Clear fault codes?"
          module="Engine (OBD)"
          whatChanges="This erases the stored and pending fault codes and resets the readiness monitors. Permanent codes, if any, only erase themselves after the car verifies the fault is gone. The scan above is already saved to history."
          reversal="No. Erased codes cannot be put back. This is still safe to do: the codes stay saved in scan history and in the write history below, and a fault that is still present will report itself again on its own."
          confirmLabel="Yes, clear"
          busyLabel="Clearing…"
          busy={clearMutation.isPending}
          onConfirm={doClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </Card>
  );
}
