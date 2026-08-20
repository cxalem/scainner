import { useEffect, useState } from "react";
import { invoke } from "@/lib/tauri";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, Segmented } from "@/components/ui";
import { GAUGES, RANGES, STAT_LABELS, type CarReport, type HistoryPoint } from "@/lib/meta";

function TrendChart() {
  const [key, setKey] = useState("voltage");
  const [hours, setHours] = useState(24);
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [extraKeys, setExtraKeys] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>("reading_keys")
      .then((ks) => setExtraKeys(ks.filter((k) => !GAUGES.some((g) => g.key === k))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    invoke<HistoryPoint[]>("history", { key, sinceHours: hours })
      .then(setPoints)
      .catch(() => setPoints([]))
      .finally(() => setLoading(false));
  }, [key, hours]);

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
              {loading ? "loading…" : `${points.length} samples`}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
            {RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setHours(r.hours)}
                className={
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
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
        {data.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted-foreground">
            No data for this range — drive with Scainner connected and it fills itself.
          </p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid strokeOpacity={0.15} vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={48} />
                <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <Tooltip
                  formatter={(v) => [`${Number(v).toFixed(1)} ${meta?.unit ?? ""}`, meta?.label ?? key]}
                  labelFormatter={(l) => `${l} UTC`}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--primary)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
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
  const [report, setReport] = useState<CarReport | null>(null);
  const [statWindow, setStatWindow] = useState<"7d" | "all">("7d");

  useEffect(() => {
    invoke<[string, number][]>("report_cars")
      .then((cars) => (cars.length > 0 ? invoke<CarReport>("car_report", { vin: cars[0][0] }) : null))
      .then((r) => r && setReport(r))
      .catch(() => {});
  }, []);

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
          {stats.length === 0 ? (
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
          {!report || report.sessions.length === 0 ? (
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
