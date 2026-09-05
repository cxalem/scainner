import { useEffect, useState } from "react";
import { Effect } from "effect";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { listen } from "@/lib/tauri";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { Button, Kicker, Note, ProgressBar } from "@/components/ui";
import { List, Item, Swap } from "@/motion/components";
import { useDiscoveredModules, useFingerprintExperiment } from "@/features/lab/queries";
import { RunRow, RunSection, TargetRow } from "@/views/lab/RunRow";
import { useT } from "@/i18n";
import { useToast } from "@/components/toast";

type Progress = {
  phase: "modules" | "ident" | "sweep" | "done";
  current: number;
  total: number;
  detail: string;
  modulesFound: number;
  didsFound: number;
};

type Result = {
  modules: number;
  dids: number;
  sensorsAdded: number;
  cancelled: boolean;
  autoStoppedReason: string | null;
  wasFastRefresh: boolean;
  coverage: { total: number; attempted: number; reached: number; refused: number; timedOut: number; failed: number; skipped: number };
};

export function AutoDiscovery({
  connected,
  vehicleId,
  scanning,
}: {
  connected: boolean;
  vehicleId: number | null;
  scanning: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const d = t.lab.discovery;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const found = useDiscoveredModules(vehicleId);
  const experiment = useFingerprintExperiment();
  const hasPriorFindings = (found.data?.length ?? 0) > 0;
  const [forceFull, setForceFull] = useState(false);
  const [experimentCopied, setExperimentCopied] = useState(false);

  useEffect(() => {
    const un = listen<Progress>("discovery-progress", (e) => setProgress(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const start = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const r = await runPromise(Effect.flatMap(DeviceService, (dev) => dev.discoverSensors(forceFull || !hasPriorFindings)));
      setResult({
        modules: r.modules_found,
        dids: r.dids_found,
        sensorsAdded: r.sensors_added,
        cancelled: r.outcome.status === "cancelled" || r.cancelled,
        autoStoppedReason: r.outcome.status === "skipped_for_safety" ? r.outcome.detail : (r.auto_stopped_reason ?? null),
        wasFastRefresh: r.was_fast_refresh ?? false,
        coverage: {
          total: r.coverage.candidates_total,
          attempted: r.coverage.candidates_attempted,
          reached: r.coverage.reached,
          refused: r.coverage.refused,
          timedOut: r.coverage.timed_out,
          failed: r.coverage.transport_failed + r.coverage.malformed,
          skipped: r.coverage.candidates_skipped,
        },
      });
      void found.refetch();
      void experiment.refetch();
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      if (message.includes("ride_in_progress")) toast.show("warning", t.ride.ride_in_progress);
      setError(message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const cancel = () => void runPromise(Effect.flatMap(DeviceService, (dev) => dev.udsCancelScan()));

  const copyExperiment = async () => {
    if (experiment.data == null) return;
    await navigator.clipboard.writeText(JSON.stringify(experiment.data, null, 2));
    setExperimentCopied(true);
    window.setTimeout(() => setExperimentCopied(false), 2000);
  };

  const pct = progress != null && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const active = running || scanning;
  const canRun = connected && vehicleId != null && !active;
  const state = active ? "running" : result != null ? "done" : "idle";
  const summary =
    result == null
      ? ""
      : result.autoStoppedReason === "engine_started"
        ? d.engineStartedSummary(result.modules, result.dids)
        : result.cancelled
          ? d.cancelledSummary(result.modules, result.dids)
          : result.wasFastRefresh
            ? d.refreshedSummary(result.modules, result.dids, result.sensorsAdded)
            : d.doneSummary(result.modules, result.dids, result.sensorsAdded);

  return (
    <>
      <RunSection>
        <RunRow
          label={active ? t.lab.run.running : result ? t.lab.run.runAgain : t.lab.run.run}
          onRun={() => void start()}
          busy={active}
          disabled={!canRun}
          note={!connected ? t.lab.run.needsCable : vehicleId == null ? d.needsVehicle : t.lab.run.noteParked}
        >
          {active && (
            <Button variant="ghost" size="sm" onClick={cancel}>
              {t.lab.run.stop}
            </Button>
          )}
          {!active && hasPriorFindings && (
            <label className="flex items-center gap-1.5 text-[12px] text-neutral-500">
              <input type="checkbox" checked={forceFull} onChange={(e) => setForceFull(e.target.checked)} />
              {d.fullRescanToggle}
            </label>
          )}
        </RunRow>
        {active && (
          <p className="flex items-center gap-1.5 text-[12px] text-warn">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {d.engineWarning}
          </p>
        )}
      </RunSection>

      <Swap k={state} className="flex flex-col gap-2 px-[17px] py-[15px]">
        {state === "running" && (
          <>
            <TargetRow
              addr=""
              name={progress ? d.phases[progress.phase] : d.running}
              detail={progress?.detail}
              trailing={progress ? `${pct} %` : undefined}
            />
            <ProgressBar value={pct} height={2} />
            {progress && <Note className="text-[11.5px]">{d.foundSoFar(progress.modulesFound, progress.didsFound)}</Note>}
          </>
        )}
        {state === "done" && result && (
          <>
            <div className="flex items-center gap-[9px] text-[13.5px]">
              <CheckCircle2 className={`h-[17px] w-[17px] ${result.cancelled ? "text-neutral-500" : "text-ok"}`} aria-hidden="true" />
              <span>{t.lab.run.doneAuto}</span>
            </div>
            <p className="text-[13px] leading-[1.55] text-neutral-300">{summary}</p>
            <Note className="text-[11.5px]">
              {d.coverageSummary(
                result.coverage.attempted,
                result.coverage.total,
                result.coverage.reached,
                result.coverage.refused,
                result.coverage.timedOut,
                result.coverage.failed,
                result.coverage.skipped,
              )}
            </Note>
          </>
        )}
        {state === "idle" && (
          <>
            <Kicker>{t.lab.run.planTitleAuto}</Kicker>
            {!hasPriorFindings && <Note>{t.lab.run.nothingDocumented}</Note>}
          </>
        )}
        {error != null && <p className="text-[12.5px] text-stop">{error}</p>}

        {found.data != null && found.data.length > 0 && (
          <List className="flex flex-col gap-2">
            {state !== "idle" && <Kicker>{d.previousFindings}</Kicker>}
            {found.data.map((m) => (
              <Item key={m.id}>
                <TargetRow
                  addr={m.address}
                  name={m.name ?? d.unnamedModule}
                  detail={d.didCount(m.did_count, m.labeled_count)}
                />
                {m.fingerprint_fields_answered > 0 && (
                  <p className="num truncate pl-[37px] text-[11px] text-neutral-500">
                    {d.fingerprintSummary(m.fingerprint_fields_answered, m.fingerprint_fields_total)}
                    {m.spare_part_number != null ? ` · ${m.spare_part_number}` : ""}
                    {m.software_version != null ? ` · ${m.software_version}` : ""}
                  </p>
                )}
              </Item>
            ))}
          </List>
        )}

        {experiment.data != null && experiment.data.vehicles_scanned > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-neutral-900 pt-2.5">
            <Kicker>{d.fingerprintExperimentTitle}</Kicker>
            <Note className="text-[11.5px]">
              {d.fingerprintExperimentProgress(
                experiment.data.vehicles_scanned,
                experiment.data.target_vehicles,
                experiment.data.vehicles_with_fingerprints,
                experiment.data.repeated_family_groups,
              )}
            </Note>
            <Button size="sm" className="self-start" onClick={() => void copyExperiment()}>
              {experimentCopied ? d.fingerprintExperimentCopied : d.fingerprintExperimentCopy}
            </Button>
          </div>
        )}
      </Swap>
    </>
  );
}
