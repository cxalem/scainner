import { Suspense, lazy, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Segmented, Skeleton } from "@/components/ui";
import { GAUGES, RANGES, STAT_LABELS } from "@/shared/domain/gauges";
import { useCarReport, useReportCars } from "@/features/vehicle/queries";
import { useHistoryPoints, useReadingKeys } from "@/features/history/queries";

// Same lazy recharts boundary Overview's battery chart uses (charts.tsx) —
// this is the second of the two usages plan.md's bundle-trim step targets.
const TrendLineChart = lazy(() => import("@/components/charts").then((m) => ({ default: m.TrendLineChart })));

function TrendChart() {
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
              aria-label="Sensor"
              className="h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            >
              {GAUGES.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label} ({g.unit})
                </option>
              ))}
              {extraKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-muted-foreground">
              {pointsQuery.isFetching ? "loading…" : `${points.length} samples`}
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
            <p className="text-destructive">Could not load this range.</p>
            <Button variant="outline" onClick={() => pointsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : data.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted-foreground">
            No data for this range — drive with Scainner connected and it fills itself.
          </p>
        ) : (
          <div className="h-72 w-full">
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <TrendLineChart data={data} unit={meta?.unit ?? ""} label={meta?.label ?? key} />
            </Suspense>
          </div>
        )}
        {key === "voltage" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Reference: 12.4–12.8 V rested · 13.5–14.8 V charging · smart alternators intentionally float lower while
            driving. Watch the trend across weeks, not single dips.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function History() {
  const [statWindow, setStatWindow] = useState<"7d" | "all">("7d");
  const carsQuery = useReportCars();
  const firstVin = carsQuery.data?.[0]?.[0] ?? null;
  const reportQuery = useCarReport(firstVin);
  const report = reportQuery.data ?? null;
  // A disabled query (no car yet, so useCarReport(null) never runs) still
  // reports isPending — gate on firstVin so an empty DB shows the real
  // empty-state copy instead of skeletons that never resolve.
  const reportLoading = carsQuery.isPending || (firstVin !== null && reportQuery.isPending);

  const stats = report ? (statWindow === "7d" ? report.stats_7d : report.stats_all) : [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">History</h1>

      <TrendChart />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Sensor ranges</span>
            <Segmented
              value={statWindow}
              onChange={setStatWindow}
              options={[
                { value: "7d", label: "Last 7 days" },
                { value: "all", label: "All time" },
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
            <p className="text-sm text-muted-foreground">No recorded data in this window yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-1 font-medium">Sensor</th>
                  <th className="pb-1 text-right font-medium">min</th>
                  <th className="pb-1 text-right font-medium">avg</th>
                  <th className="pb-1 text-right font-medium">max</th>
                  <th className="pb-1 text-right font-medium">samples</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.key} className="border-b border-border/50 last:border-0">
                    <td className="py-1">{STAT_LABELS[s.key] ?? s.key}</td>
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
          <CardTitle>Sessions{report ? ` (latest ${report.sessions.length})` : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          {reportLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : !report || report.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-1 font-medium">Started (UTC)</th>
                  <th className="pb-1 text-right font-medium">Duration</th>
                  <th className="pb-1 text-right font-medium">Max speed</th>
                  <th className="pb-1 text-right font-medium">Max coolant</th>
                  <th className="pb-1 text-right font-medium">Min volts</th>
                  <th className="pb-1 text-right font-medium">Readings</th>
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
