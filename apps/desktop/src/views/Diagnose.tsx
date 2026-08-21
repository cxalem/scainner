import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { MONITOR_LABELS } from "@/shared/domain/gauges";
import type { DtcResult, ObdClearOutcome } from "@scainner/core";
import { WriteHistory } from "@/components/WriteHistory";
import { useDtcHistory } from "@/features/diagnose/queries";
import { CodeBadge } from "@/views/diagnose/CodeBadge";
import { ScanConsole } from "@/views/diagnose/ScanConsole";
import { DtcDetailModal } from "@/views/diagnose/DtcDetailModal";
import { AiReportCard } from "@/views/diagnose/AiReportCard";

// Scan History rows are compact, historical entries (unlike ScanConsole's
// scrollable workspace, which is the deep-dive surface) — past this many
// codes a row switches to "+N more" instead of trying to fit every badge,
// which is what was actually overflowing the card at 80+ codes.
const HISTORY_ROW_CODE_LIMIT = 8;

export function Diagnose({ connected }: { connected: boolean }) {
  const [scan, setScan] = useState<DtcResult | null>(null);
  const [readiness, setReadiness] = useState<Record<string, boolean> | null>(null);
  const [detailCode, setDetailCode] = useState<string | null>(null);

  const historyQuery = useDtcHistory();
  const history = historyQuery.data ?? [];

  const handleScanSuccess = (scanResult: DtcResult, readinessResult: Record<string, boolean> | null) => {
    setScan(scanResult);
    setReadiness(readinessResult);
  };

  const handleClearSuccess = (outcome: ObdClearOutcome) => {
    setScan(outcome.after);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Diagnose</h1>

      <ScanConsole
        connected={connected}
        scan={scan}
        onScanSuccess={handleScanSuccess}
        onClearSuccess={handleClearSuccess}
        onSelect={setDetailCode}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Readiness monitors
          </CardTitle>
        </CardHeader>
        <CardContent>
          {readiness === null ? (
            <p className="text-sm text-muted-foreground">Run a scan to check readiness monitors.</p>
          ) : (
            <div className="animate-fade-slide-in">
              <div className="flex flex-wrap gap-2">
                {Object.entries(readiness).map(([monitor, ready]) => (
                  <Badge key={monitor} variant={ready ? "ok" : "warn"}>
                    {MONITOR_LABELS[monitor] ?? monitor}: {ready ? "ready" : "not ready"}
                  </Badge>
                ))}
              </div>
              {Object.values(readiness).every(Boolean) ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  All monitors complete. This is what a technical or emissions inspection checks (ITV in Spain).
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Some monitors incomplete (normal after clearing codes or a battery disconnect — they re-run over a
                  few drives).
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Everything above is the live workspace (scan → review → clean →
          rescan, the loop most people open this app to do — Alejandro,
          2026-08-21: "we need to make this tool specifically for that").
          Everything below is the archive: past scans and writes, not
          something you act on while working a car right now. The divider
          says so plainly instead of leaving five cards to read as one
          undifferentiated list. */}
      <div className="mt-2 flex flex-col gap-0.5 border-t border-border pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">History &amp; reports</h2>
        <p className="text-xs text-muted-foreground">Past scans and writes — separate from the live workspace above.</p>
      </div>

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
                const codes = [...new Set([...scan.stored, ...scan.pending, ...scan.permanent])];
                const shown = codes.slice(0, HISTORY_ROW_CODE_LIMIT);
                const hiddenCount = codes.length - shown.length;
                return (
                  <li
                    key={scan.id}
                    className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border py-1.5 last:border-0"
                  >
                    <span className="font-mono text-xs text-muted-foreground">{scan.ts} UTC</span>
                    <span className="flex flex-wrap items-center gap-2">
                      {codes.length === 0 ? (
                        <Badge variant="ok">clean</Badge>
                      ) : (
                        <>
                          {shown.map((code) => (
                            <CodeBadge key={code} code={code} onSelect={setDetailCode} />
                          ))}
                          {hiddenCount > 0 && <Badge variant="muted">+{hiddenCount} more</Badge>}
                        </>
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
