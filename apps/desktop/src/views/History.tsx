import { Suspense, lazy, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Segmented, Skeleton } from "@/components/ui";
import { GAUGES, RANGES, gaugeLabel, statLabel } from "@/shared/domain/gauges";
import { useVehicleReport, useVehicles } from "@/features/vehicle/queries";
import { useHistoryPoints, useReadingKeys } from "@/features/history/queries";
import { useLocale, useT } from "@/i18n";

// Same lazy recharts boundary Overview's battery chart uses (charts.tsx) —
// this is the second of the two usages plan.md's bundle-trim step targets.
const TrendLineChart = lazy(() => import("@/components/charts").then((m) => ({ default: m.TrendLineChart })));

function TrendChart() {
  const t = useT();
  const { locale } = useLocale();
  const [key, setKey] = useState("voltage");
  const [hours, setHours] = useState(24);
  const readingKeysQuery = useReadingKeys();
  const extraKeys = (readingKeysQuery.data ?? []).filter((k) => !GAUGES.some((g) => g.key === k));
  const pointsQuery = useHistoryPoints(key, hours);
  const points = pointsQuery.data ?? [];

  const meta = GAUGES.find((g) => g.key === key);
  const step = Math.max(1, Math.floor(points.length / 600));
  const data = points.filter((_, i) => i % step === 0).map((p) => ({ ...p, t: p.ts.slice(5, 16) }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <select
              aria-label={t.history.trend.sensorAriaLabel}
              className="h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            >
              {GAUGES.map((g) => (
                <option key={g.key} value={g.key}>
                  {gaugeLabel(g.key, locale)} ({g.unit})
                </option>
              ))}
              {extraKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-muted-foreground">
              {pointsQuery.isFetching ? t.history.trend.loading : t.history.trend.samples(points.length)}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
            {RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setHours(r.hours)}
                className={
                  "rounded-md px-2.5 py-1 text-xs font-medium " +
                  "transition-[color,background-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
                  (hours === r.hours ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")
                }
              >
                {r.label}
              </button>
            ))}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pointsQuery.isPending ? (
          // Fixed-size skeleton instead of the old "loading…" text — no
          // size jump once the chart lands (plan.md step 3).
          <Skeleton className="h-72 w-full" />
        ) : pointsQuery.isError ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center text-sm">
            <p className="text-destructive">{t.history.trend.couldNotLoad}</p>
            <Button variant="outline" onClick={() => pointsQuery.refetch()}>
              {t.common.retry}
            </Button>
          </div>
        ) : data.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted-foreground">{t.history.trend.noDataForRange}</p>
        ) : (
          <div className="h-72 w-full">
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <TrendLineChart data={data} unit={meta?.unit ?? ""} label={meta?.label ?? key} />
            </Suspense>
          </div>
        )}
        {key === "voltage" && (
          <p className="mt-2 text-xs text-muted-foreground">{t.history.trend.voltageReferenceNote}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function History({ connState = "disconnected", vehicleId: connectedVehicleId = null }: { connState?: string; vehicleId?: number | null }) {
  const t = useT();
  const { locale } = useLocale();
  const [statWindow, setStatWindow] = useState<"7d" | "all">("7d");
  const vehiclesQuery = useVehicles();
  // While connected: strictly the connected vehicle (null = unidentified,
  // show nothing rather than another car's history — the live 2026-08-21
  // bug class). While browsing disconnected: default to the busiest car.
  const vehicleId =
    connState === "connected" ? connectedVehicleId : (connectedVehicleId ?? vehiclesQuery.data?.[0]?.id ?? null);
  const reportQuery = useVehicleReport(vehicleId);
  const report = reportQuery.data ?? null;
  // A disabled query (no vehicle, so useVehicleReport(null) never runs)
  // still reports isPending — gate on vehicleId so an empty DB shows the
  // real empty-state copy instead of skeletons that never resolve.
  const reportLoading = vehiclesQuery.isPending || (vehicleId !== null && reportQuery.isPending);

  const stats = report ? (statWindow === "7d" ? report.stats_7d : report.stats_all) : [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">{t.history.title}</h1>

      <TrendChart />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{t.history.sensorRanges.cardTitle}</span>
            <Segmented
              value={statWindow}
              onChange={setStatWindow}
              options={[
                { value: "7d", label: t.history.sensorRanges.last7Days },
                { value: "all", label: t.history.sensorRanges.allTime },
              ]}
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reportLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : stats.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.history.sensorRanges.noDataYet}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-1 font-medium">{t.history.sensorRanges.sensor}</th>
                  <th className="pb-1 text-right font-medium">{t.history.sensorRanges.min}</th>
                  <th className="pb-1 text-right font-medium">{t.history.sensorRanges.avg}</th>
                  <th className="pb-1 text-right font-medium">{t.history.sensorRanges.max}</th>
                  <th className="pb-1 text-right font-medium">{t.history.sensorRanges.samples}</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.key} className="border-b border-border/50 last:border-0">
                    <td className="py-1">{statLabel(s.key, locale)}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{s.min.toFixed(1)}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{s.avg.toFixed(1)}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{s.max.toFixed(1)}</td>
                    <td className="py-1 text-right font-mono text-xs text-muted-foreground">{s.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {report ? t.history.sessions.cardTitleWithCount(report.sessions.length) : t.history.sessions.cardTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reportLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : !report || report.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.history.sessions.noSessionsYet}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-1 font-medium">{t.history.sessions.startedUtc}</th>
                  <th className="pb-1 text-right font-medium">{t.history.sessions.duration}</th>
                  <th className="pb-1 text-right font-medium">{t.history.sessions.maxSpeed}</th>
                  <th className="pb-1 text-right font-medium">{t.history.sessions.maxCoolant}</th>
                  <th className="pb-1 text-right font-medium">{t.history.sessions.minVolts}</th>
                  <th className="pb-1 text-right font-medium">{t.history.sessions.readings}</th>
                </tr>
              </thead>
              <tbody>
                {report.sessions.map((s) => (
                  <tr key={s.id} className="border-b border-border/50 last:border-0">
                    <td className="py-1 font-mono text-xs">{s.started_at}</td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {s.ended_at ? `${Math.round(s.minutes)}m` : "…"}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {s.max_speed != null ? s.max_speed.toFixed(0) : "—"}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {s.max_coolant != null ? `${s.max_coolant.toFixed(0)}°` : "—"}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {s.min_voltage != null ? s.min_voltage.toFixed(1) : "—"}
                    </td>
                    <td className="py-1 text-right font-mono text-xs text-muted-foreground">{s.readings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
