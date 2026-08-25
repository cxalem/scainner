// One-button sensor discovery. Takes no inputs on purpose: which modules
// exist and which DID neighborhoods hold data come from the car's VIN and
// the shipped knowledge map, never from the user — "nobody knows their
// car's DID ranges, so we can't ask for them" (owner, 2026-08-23). A hit
// the map has a full decode formula for is promoted straight into the
// live poll loop server-side (uds::discover's sensors_added) — run this
// once, that sensor behaves like a normal OBD gauge from then on, no
// re-scanning needed (owner, 2026-08-24). The manual tools below (Lab.tsx's
// "Advanced" section) stay for brands this map doesn't cover yet.
import { useEffect, useState } from "react";
import { Effect } from "effect";
import { AlertTriangle, Radar, X } from "lucide-react";
import { listen } from "@/lib/tauri";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { useDiscoveredModules } from "@/features/lab/queries";
import { useT } from "@/i18n";

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
  coverage: {
    total: number;
    attempted: number;
    reached: number;
    refused: number;
    timedOut: number;
    failed: number;
    skipped: number;
  };
};

export function AutoDiscovery({
  connected,
  vehicleId,
  scanning,
}: {
  connected: boolean;
  vehicleId: number | null;
  /// A scan is running RIGHT NOW, possibly started from this card in a
  /// different tab visit, possibly not — this comes from the global
  /// conn-status broadcast, so it's accurate either way. Lets this card
  /// show the truth ("a scan is running, here's Cancel") instead of
  /// looking idle just because its own local state was reset by
  /// switching tabs away and back (owner, 2026-08-24).
  scanning: boolean;
}) {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const found = useDiscoveredModules(vehicleId);
  const hasPriorFindings = (found.data?.length ?? 0) > 0;
  const [forceFull, setForceFull] = useState(false);

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
      const r = await runPromise(Effect.flatMap(DeviceService, (d) => d.discoverSensors(forceFull || !hasPriorFindings)));
      setResult({
        modules: r.modules_found,
        dids: r.dids_found,
        sensorsAdded: r.sensors_added,
        cancelled: r.outcome.status === "cancelled" || r.cancelled,
        autoStoppedReason:
          r.outcome.status === "skipped_for_safety" ? r.outcome.detail : (r.auto_stopped_reason ?? null),
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
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const cancel = () => void runPromise(Effect.flatMap(DeviceService, (d) => d.udsCancelScan()));

  const pct = progress != null && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const phaseLabel = progress != null ? t.lab.discovery.phases[progress.phase] : "";
  // Either this card started the scan (running) or another tab/session
  // did (scanning && !running) — both need the same "it's active" UI.
  const active = running || scanning;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Radar className="h-4 w-4" aria-hidden="true" /> {t.lab.discovery.cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">{t.lab.discovery.explainer}</p>

        {vehicleId == null ? (
          <p className="text-muted-foreground">{t.lab.discovery.needsVehicle}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void start()} disabled={!connected || active}>
                <Radar className={"h-4 w-4" + (active ? " animate-pulse" : "")} aria-hidden="true" />
                {active ? t.lab.discovery.running : t.lab.discovery.start}
              </Button>
              {active && (
                <Button variant="outline" onClick={cancel}>
                  <X className="h-4 w-4" aria-hidden="true" /> {t.common.cancel}
                </Button>
              )}
              {!active && hasPriorFindings && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={forceFull} onChange={(e) => setForceFull(e.target.checked)} />
                  {t.lab.discovery.fullRescanToggle}
                </label>
              )}
            </div>
            {/* The literal safety ask (owner, 2026-08-24): flag the risk
                while a scan is active, not just after something goes
                wrong. A module held in an extended session while the
                engine starts can throw dash warnings/comm faults on it —
                the scan auto-stops on an engine-start signal, but that
                isn't instant, so the warning matters too. */}
            {active && (
              <p className="flex items-center gap-1.5 text-xs text-warn">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t.lab.discovery.engineWarning}
              </p>
            )}
          </div>
        )}

        {progress != null && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {phaseLabel} <span className="font-mono">{progress.detail}</span>
              </span>
              <span className="font-mono tabular-nums">{pct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t.lab.discovery.foundSoFar(progress.modulesFound, progress.didsFound)}
            </p>
          </div>
        )}

        {result != null && (
          <div className="flex flex-col gap-1">
            <p className={result.cancelled ? "text-muted-foreground" : "text-foreground"}>
              {result.autoStoppedReason === "engine_started"
                ? t.lab.discovery.engineStartedSummary(result.modules, result.dids)
                : result.cancelled
                  ? t.lab.discovery.cancelledSummary(result.modules, result.dids)
                  : result.wasFastRefresh
                    ? t.lab.discovery.refreshedSummary(result.modules, result.dids, result.sensorsAdded)
                    : t.lab.discovery.doneSummary(result.modules, result.dids, result.sensorsAdded)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t.lab.discovery.coverageSummary(
                result.coverage.attempted,
                result.coverage.total,
                result.coverage.reached,
                result.coverage.refused,
                result.coverage.timedOut,
                result.coverage.failed,
                result.coverage.skipped,
              )}
            </p>
          </div>
        )}
        {error != null && <p className="text-destructive">{error}</p>}

        {found.data != null && found.data.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.lab.discovery.previousFindings}</p>
            <ul className="flex flex-col gap-1">
              {found.data.map((m) => (
                <li key={m.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2">
                  <span className="font-mono text-xs">{m.address}</span>
                  <span className="truncate">{m.name ?? t.lab.discovery.unnamedModule}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {t.lab.discovery.didCount(m.did_count, m.labeled_count)}
                  </span>
                  {m.fingerprint_fields_answered > 0 && (
                    <span className="col-start-2 col-end-4 truncate text-xs text-muted-foreground">
                      {t.lab.discovery.fingerprintSummary(
                        m.fingerprint_fields_answered,
                        m.fingerprint_fields_total,
                      )}
                      {m.spare_part_number != null ? ` · ${m.spare_part_number}` : ""}
                      {m.software_version != null ? ` · ${m.software_version}` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
