import { useState } from "react";
import { invoke } from "@/lib/tauri";
import { Activity, Database, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Segmented } from "@/components/ui";
import { GAUGES, type Live as LiveMap, type SensorReading } from "@/lib/meta";

function Gauges({ live }: { live: LiveMap }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {GAUGES.map((g) => {
        const v = live[g.key];
        return (
          <Card key={g.key} className={v === undefined ? "opacity-50" : ""}>
            <CardHeader>
              <CardTitle>{g.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-semibold tabular-nums">
                {v === undefined ? "—" : g.fmt ? g.fmt(v) : v}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{g.unit}</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AllSensorsTable({ connected }: { connected: boolean }) {
  const [rows, setRows] = useState<SensorReading[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const readAll = async () => {
    setReading(true);
    setError(null);
    try {
      const r = await invoke<SensorReading[]>("all_sensors");
      setRows(r);
      setReadAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(String(e));
    } finally {
      setReading(false);
    }
  };

  const shown = rows.filter(
    (r) =>
      !filter ||
      r.label.toLowerCase().includes(filter.toLowerCase()) ||
      r.pid.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={readAll} disabled={!connected || reading}>
          <RefreshCw className={"h-4 w-4" + (reading ? " animate-spin" : "")} aria-hidden="true" />
          {reading ? "Interrogating ECU…" : "Read all sensors"}
        </Button>
        <input
          aria-label="Filter sensors"
          className="h-9 rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {readAt && (
          <span className="text-xs text-muted-foreground">
            read at {readAt} · {rows.length} sensors
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
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
                {shown.map((r) => (
                  <tr key={r.pid} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 font-mono text-xs text-muted-foreground">{r.pid}</td>
                    <td className="py-1.5">{r.label}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {r.value.toFixed(1)} <span className="text-xs text-muted-foreground">{r.unit}</span>
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
