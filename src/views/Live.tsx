import { useState } from "react";
import { Activity, Database, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Segmented, useCyclingLabel } from "@/components/ui";
import { ALL_SENSORS_PHRASES, GAUGES } from "@/shared/domain/gauges";
import type { Live as LiveMap } from "@/shared/domain/connection";
import { useAllSensors } from "@/features/live/queries";

function Gauges({ live }: { live: LiveMap }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {GAUGES.map((gauge) => {
        const value = live[gauge.key];
        return (
          <Card key={gauge.key} className={value === undefined ? "opacity-50" : ""}>
            <CardHeader>
              <CardTitle>{gauge.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-semibold tabular-nums">
                {value === undefined ? "—" : gauge.fmt ? gauge.fmt(value) : value}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{gauge.unit}</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AllSensorsTable({ connected }: { connected: boolean }) {
  const sensorsQuery = useAllSensors();
  const rows = sensorsQuery.data ?? [];
  const reading = sensorsQuery.isFetching;
  const readingLabel = useCyclingLabel(ALL_SENSORS_PHRASES, reading, 3000);
  const [filter, setFilter] = useState("");

  const shown = rows.filter(
    (r) =>
      !filter ||
      r.label.toLowerCase().includes(filter.toLowerCase()) ||
      r.pid.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => sensorsQuery.refetch()} disabled={!connected || reading}>
          <RefreshCw className={"h-4 w-4" + (reading ? " animate-spin" : "")} aria-hidden="true" />
          {reading ? readingLabel : "Read all sensors"}
        </Button>
        <input
          aria-label="Filter sensors"
          className="h-9 rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {sensorsQuery.dataUpdatedAt > 0 && rows.length > 0 && (
          <span className="text-xs text-muted-foreground">
            read at {new Date(sensorsQuery.dataUpdatedAt).toLocaleTimeString()} · {rows.length} sensors
          </span>
        )}
      </div>

      {sensorsQuery.isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {String(sensorsQuery.error instanceof Error ? sensorsQuery.error.message : sensorsQuery.error)}
        </div>
      )}

      {rows.length === 0 && !reading ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Activity className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">Every sensor your ECU admits to having</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              The car reports which readings it supports; this reads all of them in one sweep (~15 s). Connect and
              press Read.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">PID</th>
                  <th className="pb-2 font-medium">Sensor</th>
                  <th className="pb-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((reading) => (
                  <tr key={reading.pid} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 font-mono text-xs text-muted-foreground">{reading.pid}</td>
                    <td className="py-1.5">{reading.label}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {reading.value.toFixed(1)} <span className="text-xs text-muted-foreground">{reading.unit}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function Live({ live, connected }: { live: LiveMap; connected: boolean }) {
  const [mode, setMode] = useState<"gauges" | "table">("gauges");
  const hasData = Object.keys(live).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Live</h1>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "gauges", label: "Gauges" },
            { value: "table", label: "All sensors" },
          ]}
        />
      </div>

      {mode === "gauges" ? (
        <>
          {!connected && !hasData && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <Activity className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="font-medium">Not connected</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Turn the ignition on, then press Connect in the sidebar. Everything records automatically while
                  connected.
                </p>
              </CardContent>
            </Card>
          )}
          <Gauges live={live} />
          {hasData && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Database className="h-3 w-3" aria-hidden="true" />
              Recording continuously — every value on this screen is being saved.
            </p>
          )}
        </>
      ) : (
        <AllSensorsTable connected={connected} />
      )}
    </div>
  );
}
