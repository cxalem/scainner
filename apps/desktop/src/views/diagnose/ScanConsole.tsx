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
import { useLocale, useT } from "@/i18n";
import { formatVoltage } from "@/lib/format";

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
// (Diagnose.tsx) — Readiness monitors and the AI report card need the same
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
  const t = useT();
  const { locale } = useLocale();
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearedBanner, setClearedBanner] = useState<{ before: number; after: number } | null>(null);

  const scanMutation = useScanDtcs();
  const clearMutation = useClearDtcs();
  const error = scanMutation.error ?? clearMutation.error;
  const cyclingLabel = useCyclingLabel(t.diagnose.console.scanningPhrases, scanMutation.isPending);

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
          <CardTitle>{t.diagnose.console.cardTitle}</CardTitle>
          <div className="flex items-center gap-2">
            <Button onClick={doScan} disabled={!connected || scanMutation.isPending}>
              <RefreshCw className={"h-4 w-4" + (scanMutation.isPending ? " animate-spin" : "")} aria-hidden="true" />
              {scanMutation.isPending ? t.diagnose.console.scanning : t.diagnose.console.scan}
            </Button>
            {/* Stays mounted while ConfirmWrite is up — hiding it shifted
                the toolbar behind the modal (no layout shifts). */}
            {scan && totalCodes > 0 && (
              <Button variant="outline" onClick={() => setConfirmClear(true)} disabled={confirmClear}>
                {t.diagnose.console.clearCodes}
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {/* Backend error text — untranslated in Phase 1, see plan.md's
                Phase 5 (Rust/backend strings) */}
            {String(error instanceof Error ? error.message : error)}
          </div>
        )}

        {clearedBanner && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/50 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              {clearedBanner.after === 0 ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t.diagnose.console.clearedVerified(clearedBanner.before)}
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
                  {t.diagnose.console.clearedButCameBack(clearedBanner.after)}
                </>
              )}
            </p>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t.diagnose.console.resetNote}
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
              <p className="text-sm text-muted-foreground">{t.diagnose.console.noScanYet}</p>
              <p className="text-sm text-muted-foreground">{t.diagnose.console.clickToScan}</p>
            </div>
          ) : (
            <div className="animate-fade-slide-in flex flex-1 flex-col gap-3 overflow-hidden">
              {/* Pinned, never scrolls away — freeze frame was landing at
                  the bottom of the code list before this, invisible behind
                  however many codes came before it (Alejandro, 2026-08-21:
                  "that information remains hidden... important information
                  should be visible"). Only the code groups below scroll;
                  the state summary of the car at the moment of the scan
                  never does. */}
              <div className="flex items-center gap-2">
                {scan.mil_on ? (
                  <Badge variant="error">{t.diagnose.console.milOn(scan.dtc_count)}</Badge>
                ) : (
                  <Badge variant="ok">
                    <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> {t.diagnose.console.milOff}
                  </Badge>
                )}
                {scan.voltage != null && <Badge variant="muted">{formatVoltage(scan.voltage, locale)}</Badge>}
              </div>
              <VoltageClusterNote scan={scan} />
              {scan.freeze && <FreezeFrame data={scan.freeze as Record<string, unknown>} />}

              {totalCodes === 0 ? (
                // A real empty state, not a stray line of text inside an
                // otherwise-empty 26rem box — this is what it looked like
                // right after a successful clear (Alejandro, 2026-08-21:
                // "the space looks empty, looks weird... we need
                // information for the empty state"). Centered like the
                // idle/scanning states above, and this is a GOOD outcome
                // (a clean car), so it reads as confirmation, not as
                // something broken.
                <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
                  <CheckCircle2 className="mb-1 h-6 w-6 text-primary" aria-hidden="true" />
                  <p className="text-sm font-medium">{t.diagnose.console.noFaultCodesTitle}</p>
                  <p className="text-sm text-muted-foreground">{t.diagnose.console.noFaultCodesExplainer}</p>
                </div>
              ) : (
                // overflow-y-scroll (not -auto): a small scan that fits
                // without scrolling and a large one that needs to scroll
                // would otherwise render at different widths — same
                // gutter fix as Shell.tsx's outer scroll area, just local
                // here.
                <div className="flex flex-1 flex-col gap-3 overflow-y-scroll pr-1">
                  <CodeStatusSection
                    label={t.diagnose.statusLabels.stored}
                    codes={scan.stored}
                    affected={voltageAffected}
                    onSelect={onSelect}
                  />
                  <CodeStatusSection
                    label={t.diagnose.statusLabels.pending}
                    codes={scan.pending}
                    affected={voltageAffected}
                    onSelect={onSelect}
                  />
                  <CodeStatusSection
                    label={t.diagnose.statusLabels.permanent}
                    codes={scan.permanent}
                    affected={voltageAffected}
                    onSelect={onSelect}
                  />
                  <p className="text-xs text-muted-foreground">{t.diagnose.console.clickCodeHint}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>

      {confirmClear && (
        <ConfirmWrite
          title={t.diagnose.confirmClear.title}
          module={t.diagnose.confirmClear.module}
          whatChanges={t.diagnose.confirmClear.whatChanges}
          reversal={t.diagnose.confirmClear.reversal}
          confirmLabel={t.diagnose.confirmClear.confirmLabel}
          busyLabel={t.diagnose.confirmClear.busyLabel}
          busy={clearMutation.isPending}
          onConfirm={doClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </Card>
  );
}
