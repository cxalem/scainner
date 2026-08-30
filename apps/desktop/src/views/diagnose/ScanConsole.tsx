import { useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Circle, Eraser, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Banner, Button, Card, EmptyState, Mono } from "@/components/ui";
import { Stagger, Row, Swap } from "@/motion/components";
import type { DtcResult, DtcScanRow, ObdClearOutcome } from "@scainner/core";
import { ConfirmWrite } from "@/components/ConfirmWrite";
import { useClearDtcs, useScanDtcs } from "@/features/diagnose/queries";
import { detectVoltageCluster } from "@/lib/dtc-grouping";
import { CodeRow, type CodeStatus } from "@/views/diagnose/CodeRow";
import { useT } from "@/i18n";

// The four things one scan does, shown as a list of sentences rather than a
// spinner. The backend runs them as one call, so progress here is paced on
// a timer while the mutation is pending and settles to "all done" with it.
const STEP_KEYS = ["standard", "modules", "freeze", "readiness"] as const;
const STEP_MS = 800;

type ScanState = "idle" | "running" | "done" | "clear";

export function ScanConsole({
  connected,
  scan,
  history,
  readiness,
  onScanSuccess,
  onClearSuccess,
}: {
  connected: boolean;
  scan: DtcResult | null;
  history: DtcScanRow[];
  readiness: Record<string, boolean> | null;
  onScanSuccess: (scan: DtcResult, readiness: Record<string, boolean> | null) => void;
  onClearSuccess: (outcome: ObdClearOutcome) => void;
}) {
  const t = useT();
  const [confirmClear, setConfirmClear] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [scannedAt, setScannedAt] = useState<string | null>(null);

  const scanMutation = useScanDtcs();
  const clearMutation = useClearDtcs();
  const error = scanMutation.error ?? clearMutation.error;
  const pending = scanMutation.isPending;

  useEffect(() => {
    if (!pending) return;
    setStep(0);
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, STEP_KEYS.length - 1)), STEP_MS);
    return () => window.clearInterval(id);
  }, [pending]);

  const codes: { code: string; status: CodeStatus }[] = scan
    ? [
        ...scan.stored.map((code) => ({ code, status: "stored" as const })),
        ...scan.permanent.filter((c) => !scan.stored.includes(c)).map((code) => ({ code, status: "permanent" as const })),
        ...scan.pending.filter((c) => !scan.stored.includes(c)).map((code) => ({ code, status: "pending" as const })),
      ]
    : [];
  const total = codes.length;
  const voltageAffected = new Set(scan ? (detectVoltageCluster(scan)?.affected ?? []) : []);
  const state: ScanState = pending ? "running" : !scan ? "idle" : cleared && total === 0 ? "clear" : "done";

  const doScan = () => {
    setCleared(false);
    setOpenCode(null);
    scanMutation.mutate(undefined, {
      onSuccess: ({ scan: scanResult, readiness: readinessResult }) => {
        setScannedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        onScanSuccess(scanResult, readinessResult);
      },
    });
  };

  const doClear = () => {
    clearMutation.mutate(undefined, {
      onSuccess: (outcome) => {
        onClearSuccess(outcome);
        setCleared(true);
        setOpenCode(null);
      },
      onSettled: () => setConfirmClear(false),
    });
  };

  const monitorsDone = readiness ? Object.values(readiness).filter(Boolean).length : 0;
  const monitorsTotal = readiness ? Object.keys(readiness).length : 0;
  const subline = !connected
    ? t.diagnose.v2.sublineArchive
    : scan && scannedAt
      ? t.diagnose.v2.sublineDone(scannedAt)
      : t.diagnose.v2.sublineIdle;

  return (
    <Card flush>
      <div className="flex items-center gap-3 border-b border-divider px-[17px] py-[13px]">
        <Button variant="primary" icon={Search} busy={pending} onClick={doScan} disabled={!connected}>
          {pending ? t.diagnose.v2.scanning : scan ? t.diagnose.v2.scanAgain : t.diagnose.v2.scanForFaults}
        </Button>
        <span className="flex-1 text-[12px] text-neutral-500">{subline}</span>
        {scan && total > 0 && !pending && (
          <Button variant="ghost" size="sm" icon={Eraser} onClick={() => setConfirmClear(true)} disabled={!connected}>
            {t.diagnose.console.clearCodes}
          </Button>
        )}
      </div>

      {error && (
        <Banner tone="stop" icon={AlertTriangle}>
          {String(error instanceof Error ? error.message : error)}
        </Banner>
      )}

      <Swap k={state}>
        {state === "idle" && (
          <EmptyState icon={Search} title={t.diagnose.v2.noScanTitle} body={t.diagnose.v2.noScanBody} />
        )}
        {state === "running" && (
          <Stagger className="flex flex-col gap-[9px] px-[17px] py-[15px]">
            {STEP_KEYS.map((k, i) => {
              const done = i < step;
              const active = i === step;
              const Icon = done ? Check : active ? Loader2 : Circle;
              return (
                <Row key={k} className="flex items-center gap-2.5 text-[13px]">
                  <Icon
                    className={cn("h-[15px] w-[15px] shrink-0", done ? "text-ok" : active ? "animate-spin text-accent-400" : "text-neutral-700")}
                    aria-hidden="true"
                  />
                  <span className={cn("flex-1", i <= step ? "text-neutral-200" : "text-neutral-600")}>{t.diagnose.v2.steps[k]}</span>
                  <Mono className="text-[11.5px] text-neutral-500">{done ? t.diagnose.v2.stepDetail[k] : active ? t.diagnose.v2.working : ""}</Mono>
                </Row>
              );
            })}
          </Stagger>
        )}
        {state === "clear" && (
          <div className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-divider bg-ok-bg px-[17px] py-3 text-[13px] text-ok">
              <CheckCircle2 className="h-[17px] w-[17px]" aria-hidden="true" />
              <span className="flex-1">{t.diagnose.v2.nothingStored}</span>
            </div>
            <EmptyState icon={CheckCircle2} tone="ok" title={t.diagnose.v2.allClearTitle} body={t.diagnose.v2.allClearBody} />
          </div>
        )}
        {state === "done" && scan && (
          <div className="flex flex-col">
            <div
              className={cn(
                "flex items-center gap-3 border-b border-divider px-[17px] py-3 text-[13px]",
                scan.mil_on ? "bg-warn-bg text-warn" : total === 0 ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn",
              )}
            >
              {scan.mil_on || total > 0 ? (
                <AlertTriangle className="h-[17px] w-[17px]" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-[17px] w-[17px]" aria-hidden="true" />
              )}
              <span className="flex-1">{scan.mil_on ? t.diagnose.v2.milOn(total) : t.diagnose.v2.milOff(total)}</span>
            </div>
            {total === 0 ? (
              <EmptyState icon={CheckCircle2} tone="ok" title={t.diagnose.console.noFaultCodesTitle} body={t.diagnose.console.noFaultCodesExplainer} />
            ) : (
              codes.map(({ code, status }) => (
                <CodeRow
                  key={code}
                  code={code}
                  status={status}
                  open={openCode === code}
                  onToggle={() => setOpenCode((c) => (c === code ? null : code))}
                  history={history}
                  freeze={(scan.freeze as Record<string, unknown> | null | undefined) ?? null}
                  voltageLinked={voltageAffected.has(code)}
                />
              ))
            )}
          </div>
        )}
      </Swap>

      <ConfirmWrite
        open={confirmClear}
        title={t.diagnose.v2.clear.title}
        module={t.diagnose.confirmClear.module}
        whatChanges={t.diagnose.v2.clear.body}
        reversal={t.diagnose.confirmClear.reversal}
        confirmLabel={t.diagnose.v2.clear.confirm}
        busyLabel={t.diagnose.v2.clear.confirming}
        cancelLabel={t.diagnose.v2.clear.keep}
        nowLine={t.diagnose.v2.clear.nowLine(scan?.stored.length ?? 0, monitorsDone, monitorsTotal)}
        afterLine={t.diagnose.v2.clear.afterLine}
        busy={clearMutation.isPending}
        onConfirm={doClear}
        onCancel={() => setConfirmClear(false)}
      />
    </Card>
  );
}
