import { useState } from "react";
import { Activity, Database, RefreshCw, Radar } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Segmented, useCyclingLabel } from "@/components/ui";
import { GAUGES, gaugeLabel } from "@/shared/domain/gauges";
import type { Live as LiveMap } from "@scainner/core";
import { useAllSensors } from "@/features/live/queries";
import { useLocale, useT } from "@/i18n";

function Gauges({ live }: { live: LiveMap }) {
  const t = useT();
  const { locale } = useLocale();
  const knownKeys = new Set(GAUGES.map((gauge) => gauge.key));
  const discovered = Object.entries(live).filter(([key]) => !knownKeys.has(key));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {GAUGES.map((gauge) => {
          const value = live[gauge.key];
          return (
            <Card key={gauge.key} className={value === undefined ? "opacity-50" : ""}>
              <CardHeader>
                <CardTitle>{gaugeLabel(gauge.key, locale)}</CardTitle>
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
      {discovered.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.live.discoveredSensors}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {discovered.map(([key, value]) => (
              <Card key={key}>
                <CardHeader>
                  <CardTitle className="break-words">
                    {key.replace(/^uds_/, "").replace(/_/g, " ")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="font-mono text-2xl font-semibold tabular-nums">{value.toFixed(2)}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function AllSensorsTable({ connected }: { connected: boolean }) {
  const t = useT();
  const sensorsQuery = useAllSensors();
  const rows = sensorsQuery.data ?? [];
  const reading = sensorsQuery.isFetching;
  const readingLabel = useCyclingLabel(t.live.allSensors.readingPhrases, reading, 3000);
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
          {reading ? readingLabel : t.live.allSensors.readButton}
        </Button>
        <input
          aria-label={t.live.allSensors.filterAriaLabel}
          className="h-9 rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          placeholder={t.live.allSensors.filterPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {sensorsQuery.dataUpdatedAt > 0 && rows.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t.live.allSensors.readAt(new Date(sensorsQuery.dataUpdatedAt).toLocaleTimeString(), rows.length)}
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
            <p className="font-medium">{t.live.allSensors.emptyTitle}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t.live.allSensors.emptyExplainer}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">{t.live.allSensors.pid}</th>
                  <th className="pb-2 font-medium">{t.live.allSensors.sensor}</th>
                  <th className="pb-2 text-right font-medium">{t.live.allSensors.value}</th>
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

export function Live({
  live,
  connected,
  scanning = false,
}: {
  live: LiveMap;
  connected: boolean;
  /// A UDS scan (auto-discovery or the manual range scanner, either tab)
  /// is running — standard PID polling is paused for its duration, so
  /// nothing here would update anyway. Shown explicitly rather than
  /// letting the gauges silently go stale, and this reads from the same
  /// global conn-status every tab gets, so it's accurate even if the scan
  /// was started from the Lab tab while the user is sitting here
  /// (owner, 2026-08-24).
  scanning?: boolean;
}) {
  const t = useT();
  const [mode, setMode] = useState<"gauges" | "table">("gauges");
  const hasData = Object.keys(live).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">{t.live.title}</h1>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "gauges", label: t.live.modeGauges },
            { value: "table", label: t.live.modeAllSensors },
          ]}
        />
      </div>

      {scanning ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Radar className="h-8 w-8 animate-pulse text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">{t.live.scanningTitle}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t.live.scanningExplainer}</p>
          </CardContent>
        </Card>
      ) : mode === "gauges" ? (
        <>
          {!connected && !hasData && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <Activity className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="font-medium">{t.live.notConnectedTitle}</p>
                <p className="max-w-sm text-sm text-muted-foreground">{t.live.notConnectedExplainer}</p>
              </CardContent>
            </Card>
          )}
          <Gauges live={live} />
          {hasData && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Database className="h-3 w-3" aria-hidden="true" />
              {t.live.recordingNote}
            </p>
          )}
        </>
      ) : (
        <AllSensorsTable connected={connected} />
      )}
    </div>
  );
}
