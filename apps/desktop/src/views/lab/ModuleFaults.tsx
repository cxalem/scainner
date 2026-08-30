// Faults stored on the module itself (as opposed to the standard engine
// DTCs in Diagnose). Clearing is a real write, so it goes through the full
// safety rail: the shared ConfirmWrite modal, `confirmed: true` at the
// command boundary, and a persisted before/after row in the write history.
// The clear is verified: read, clear, read again.
import { useState } from "react";
import { Effect } from "effect";
import { useQueryClient } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { Button, Card, Mono, Note, Pill } from "@/components/ui";
import { Swap } from "@/motion/components";
import { ConfirmWrite } from "@/components/ConfirmWrite";
import type { ClearOutcome } from "@scainner/core";
import { useT } from "@/i18n";

export function ModuleFaults({ module, label, connected }: { module: string; label: string; connected: boolean }) {
  const t = useT();
  const f = t.lab.moduleFaults;
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
      qc.invalidateQueries({ queryKey: ["writes_log"] });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const state = outcome ? "outcome" : faults ? "faults" : "idle";

  return (
    <Card className="gap-[9px] px-4 py-3.5">
      <span className="text-[13px]">{f.cardTitle}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={RefreshCw} onClick={readFaults} busy={busy === "read"} disabled={!connected || busy !== null}>
          {busy === "read" ? f.reading : f.readFaults}
        </Button>
        {faults && faults.length > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setConfirmClear(true)} busy={busy === "clear"} disabled={busy !== null}>
            {busy === "clear" ? f.clearing : f.clearFaults(faults.length)}
          </Button>
        )}
      </div>
      <Swap k={state} className="flex flex-col gap-2">
        {state === "idle" && (
          <Note className="text-[11.5px]">
            {f.explainerBefore}
            <Mono>U</Mono>
            {f.explainerAfter}
          </Note>
        )}
        {state === "faults" && faults && (
          faults.length === 0 ? (
            <Note className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden="true" />
              {f.noFaultsStored}
            </Note>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {faults.map((c) => (
                <Pill key={c} variant="warn" className="num">
                  {c}
                </Pill>
              ))}
            </div>
          )
        )}
        {state === "outcome" && outcome && !outcome.accepted && (
          <Note className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
            {f.refused}
            {outcome.refusal_reason && ` ${outcome.refusal_reason}`}
          </Note>
        )}
        {state === "outcome" && outcome && outcome.accepted && (
          <div className="flex flex-col gap-1.5 rounded-md bg-bg p-2.5 text-[12.5px]">
            <p className="flex items-center gap-1.5">
              {outcome.after.length === 0 ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden="true" />
                  {f.clearedVerified(outcome.before.length)}
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
                  {f.clearedButCameBack(outcome.before.length, outcome.after.length)}
                </>
              )}
            </p>
            {outcome.before.length > 0 && <Mono className="text-[11.5px] text-neutral-500">{f.was(outcome.before.join(", "))}</Mono>}
            {outcome.after.length > 0 && <Mono className="text-[11.5px] text-neutral-500">{f.stillPresent(outcome.after.join(", "))}</Mono>}
            <Note className="flex items-start gap-1.5 text-[11.5px]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {f.dashboardLightNote}
            </Note>
          </div>
        )}
      </Swap>
      {error && <p className="text-[12px] text-stop">{error}</p>}
      {confirmClear && (
        <ConfirmWrite
          title={f.confirm.title}
          module={label}
          whatChanges={f.confirm.whatChanges}
          reversal={f.confirm.reversal}
          confirmLabel={f.confirm.confirmLabel}
          busyLabel={f.clearing}
          busy={busy !== null}
          onConfirm={clear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </Card>
  );
}
