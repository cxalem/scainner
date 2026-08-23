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
import { Radar, X } from "lucide-react";
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

export function AutoDiscovery({ connected, vehicleId }: { connected: boolean; vehicleId: number | null }) {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ modules: number; dids: number; sensorsAdded: number; cancelled: boolean } | null>(
    null,
  );
  const found = useDiscoveredModules(vehicleId);

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
      const r = await runPromise(Effect.flatMap(DeviceService, (d) => d.discoverSensors()));
      setResult({ modules: r.modules_found, dids: r.dids_found, sensorsAdded: r.sensors_added, cancelled: r.cancelled });
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
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void start()} disabled={!connected || running}>
              <Radar className={"h-4 w-4" + (running ? " animate-pulse" : "")} aria-hidden="true" />
              {running ? t.lab.discovery.running : t.lab.discovery.start}
            </Button>
            {running && (
              <Button variant="outline" onClick={cancel}>
                <X className="h-4 w-4" aria-hidden="true" /> {t.common.cancel}
              </Button>
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
          <p className={result.cancelled ? "text-muted-foreground" : "text-foreground"}>
            {result.cancelled
              ? t.lab.discovery.cancelledSummary(result.modules, result.dids)
              : t.lab.discovery.doneSummary(result.modules, result.dids, result.sensorsAdded)}
          </p>
        )}
        {error != null && <p className="text-destructive">{error}</p>}

        {found.data != null && found.data.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.lab.discovery.previousFindings}</p>
            <ul className="flex flex-col gap-1">
              {found.data.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <span className="font-mono text-xs">{m.address}</span>
                  <span className="truncate">{m.name ?? t.lab.discovery.unnamedModule}</span>
                  <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {t.lab.discovery.didCount(m.did_count, m.labeled_count)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
