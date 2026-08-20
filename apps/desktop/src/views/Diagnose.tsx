import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { MONITOR_LABELS } from "@/shared/domain/gauges";
import type { DtcResult } from "@scainner/core";
import { ConfirmWrite } from "@/components/ConfirmWrite";
import { WriteHistory } from "@/components/WriteHistory";
import { useClearDtcs, useDtcHistory, useScanDtcs } from "@/features/diagnose/queries";
import { CodeBadge } from "@/views/diagnose/CodeBadge";
import { CodeList } from "@/views/diagnose/CodeList";
import { FreezeFrame } from "@/views/diagnose/FreezeFrame";
import { DtcDetailModal } from "@/views/diagnose/DtcDetailModal";
import { AiReportCard } from "@/views/diagnose/AiReportCard";

export function Diagnose({ connected }: { connected: boolean }) {
  const [scan, setScan] = useState<DtcResult | null>(null);
  const [readiness, setReadiness] = useState<Record<string, boolean> | null>(null);
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearedBanner, setClearedBanner] = useState<{ before: number; after: number } | null>(null);

  const historyQuery = useDtcHistory();
  const history = historyQuery.data ?? [];
  const scanMutation = useScanDtcs();
  const clearMutation = useClearDtcs();
  const error = scanMutation.error ?? clearMutation.error;

  const doScan = () => {
    scanMutation.mutate(undefined, {
      onSuccess: ({ scan: scanResult, readiness: readinessResult }) => {
        setScan(scanResult);
        setReadiness(readinessResult);
      },
    });
  };

  const doClear = () => {
    // The backend does the whole verified write (scan, clear, scan again)
    // and logs it to the write history; useClearDtcs sends `confirmed: true`
    // or the command refuses — part of the write safety rail. It also
    // invalidates the writes_log query key, so WriteHistory updates itself.
    clearMutation.mutate(undefined, {
      onSuccess: (outcome) => {
        setScan(outcome.after);
        setClearedBanner({
          before: outcome.before.stored.length + outcome.before.pending.length,
          after: outcome.after.stored.length + outcome.after.pending.length,
        });
      },
      // Modal closes only once the mutation settles (success or error), not
      // on click — the previous behavior closed it immediately, leaving a
      // destructive, chained slow-hardware action with no visible owner
      // while it ran (interaction-audit.md worst offender #1).
      onSettled: () => setConfirmClear(false),
    });
  };

  const totalCodes = scan ? scan.stored.length + scan.pending.length + scan.permanent.length : 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Diagnose</h1>

      <div className="flex items-center gap-2">
        <Button onClick={doScan} disabled={!connected || scanMutation.isPending}>
          <RefreshCw className={"h-4 w-4" + (scanMutation.isPending ? " animate-spin" : "")} aria-hidden="true" />
          {scanMutation.isPending ? "Scanning…" : "Scan for codes"}
        </Button>
        {/* Stays mounted while the ConfirmWrite overlay is up: hiding it
            shifted the toolbar behind the modal (no layout shifts), and
            ModuleFaults already keeps its trigger visible. */}
        {scan && totalCodes > 0 && (
          <Button variant="outline" onClick={() => setConfirmClear(true)} disabled={confirmClear}>
            Clear codes…
          </Button>
        )}
      </div>

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
                {clearedBanner.after === 1 ? " That is an active fault" : " Those are active faults"}, not leftovers,
                and worth investigating.
              </>
            )}
          </p>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            No ignition cycle is needed for the check-engine light. It goes off with the clear. Two things reset with
            it: readiness monitors re-run over your next few drives (relevant before an ITV), and permanent codes (if
            any) erase themselves only after the car self-verifies the fault is gone.
          </p>
        </div>
      )}

      {scan && (
        <Card>
          <CardHeader>
            <CardTitle>Latest scan</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
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
            <CodeList label="Stored" codes={scan.stored} onSelect={setDetailCode} />
            <CodeList label="Pending" codes={scan.pending} onSelect={setDetailCode} />
            <CodeList label="Permanent" codes={scan.permanent} onSelect={setDetailCode} />
            <p className="text-xs text-muted-foreground">Click any code for details, its history, and an AI deep-dive.</p>
            {scan.freeze && <FreezeFrame data={scan.freeze as Record<string, unknown>} />}
          </CardContent>
        </Card>
      )}

      {readiness && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Pre-ITV readiness
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(readiness).map(([monitor, ready]) => (
                <Badge key={monitor} variant={ready ? "ok" : "warn"}>
                  {MONITOR_LABELS[monitor] ?? monitor}: {ready ? "ready" : "not ready"}
                </Badge>
              ))}
            </div>
            {Object.values(readiness).every(Boolean) ? (
              <p className="mt-2 text-sm text-muted-foreground">
                All monitors complete — emissions-wise you would pass ITV today.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Some monitors incomplete (normal after clearing codes or a battery disconnect — they re-run over a few
                drives).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Scan history</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : historyQuery.isError ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span>Could not load scan history.</span>
              <Button variant="outline" onClick={() => historyQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scans recorded yet — run one while connected.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {history.map((scan) => {
                const codeCount = scan.stored.length + scan.pending.length + scan.permanent.length;
                return (
                  <li key={scan.id} className="flex items-center justify-between border-b border-border py-1.5 last:border-0">
                    <span className="font-mono text-xs text-muted-foreground">{scan.ts} UTC</span>
                    <span className="flex items-center gap-2">
                      {codeCount === 0 ? (
                        <Badge variant="ok">clean</Badge>
                      ) : (
                        [...new Set([...scan.stored, ...scan.pending, ...scan.permanent])].map((code) => (
                          <CodeBadge key={code} code={code} onSelect={setDetailCode} />
                        ))
                      )}
                      {scan.voltage != null && (
                        <span className="font-mono text-xs text-muted-foreground">{scan.voltage.toFixed(1)}V</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <WriteHistory />

      <AiReportCard hasAnyData={history.length > 0 || scan !== null} />

      {detailCode && (
        <DtcDetailModal code={detailCode} history={history} scan={scan} onClose={() => setDetailCode(null)} />
      )}
    </div>
  );
}
