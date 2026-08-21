import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { monitorLabel } from "@/shared/domain/gauges";
import type { DtcResult, ObdClearOutcome } from "@scainner/core";
import { WriteHistory } from "@/components/WriteHistory";
import { useDtcHistory } from "@/features/diagnose/queries";
import { CodeBadge } from "@/views/diagnose/CodeBadge";
import { ScanConsole } from "@/views/diagnose/ScanConsole";
import { DtcDetailModal } from "@/views/diagnose/DtcDetailModal";
import { AiReportCard } from "@/views/diagnose/AiReportCard";
import { useLocale, useT } from "@/i18n";
import { formatVoltage } from "@/lib/format";

// Scan History rows are compact, historical entries (unlike ScanConsole's
// scrollable workspace, which is the deep-dive surface) — past this many
// codes a row switches to "+N more" instead of trying to fit every badge,
// which is what was actually overflowing the card at 80+ codes.
const HISTORY_ROW_CODE_LIMIT = 8;

export function Diagnose({ connected, vehicleId = null }: { connected: boolean; vehicleId?: number | null }) {
  const t = useT();
  const { locale } = useLocale();
  const [scan, setScan] = useState<DtcResult | null>(null);
  const [readiness, setReadiness] = useState<Record<string, boolean> | null>(null);
  const [detailCode, setDetailCode] = useState<string | null>(null);

  // Scoped to the connected vehicle (schema v2) — null means the current
  // unidentified connection's own scans, never every car's combined.
  const historyQuery = useDtcHistory(vehicleId);
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
      <h1 className="text-lg font-semibold tracking-tight">{t.diagnose.title}</h1>

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
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> {t.diagnose.readiness.cardTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {readiness === null ? (
            <p className="text-sm text-muted-foreground">{t.diagnose.readiness.runScanToCheck}</p>
          ) : (
            <div className="animate-fade-slide-in">
              <div className="flex flex-wrap gap-2">
                {Object.entries(readiness).map(([monitor, ready]) => (
                  <Badge key={monitor} variant={ready ? "ok" : "warn"}>
                    {monitorLabel(monitor, locale)}: {ready ? t.diagnose.readiness.ready : t.diagnose.readiness.notReady}
                  </Badge>
                ))}
              </div>
              {Object.values(readiness).every(Boolean) ? (
                <p className="mt-2 text-sm text-muted-foreground">{t.diagnose.readiness.allComplete}</p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{t.diagnose.readiness.someIncomplete}</p>
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
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t.diagnose.historyAndReports.heading}
        </h2>
        <p className="text-xs text-muted-foreground">{t.diagnose.historyAndReports.subheading}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.diagnose.scanHistory.cardTitle}</CardTitle>
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
              <span>{t.diagnose.scanHistory.couldNotLoad}</span>
              <Button variant="outline" onClick={() => historyQuery.refetch()}>
                {t.common.retry}
              </Button>
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.diagnose.scanHistory.noScansYet}</p>
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
                        <Badge variant="ok">{t.diagnose.scanHistory.clean}</Badge>
                      ) : (
                        <>
                          {shown.map((code) => (
                            <CodeBadge key={code} code={code} onSelect={setDetailCode} />
                          ))}
                          {hiddenCount > 0 && <Badge variant="muted">{t.diagnose.historyMore(hiddenCount)}</Badge>}
                        </>
                      )}
                      {scan.voltage != null && (
                        <span className="font-mono text-xs text-muted-foreground">{formatVoltage(scan.voltage, locale)}</span>
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
