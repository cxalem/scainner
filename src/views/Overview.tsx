import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BatteryCharging,
  ClipboardList,
  Database,
  Fuel,
  HeartPulse,
  Thermometer,
  Wind,
  Wrench,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import type { CarReport, Insights } from "@/lib/meta";

type Verdict = {
  icon: typeof Wrench;
  title: string;
  text: string;
  status: "good" | "watch" | "bad";
};

function buildVerdicts(r: CarReport): Verdict[] {
  const i = r.insights;
  const v: Verdict[] = [];

  if (r.scans_total > 0) {
    const clean = r.scans_clean === r.scans_total;
    v.push({
      icon: ClipboardList,
      title: "Fault record",
      text: clean
        ? `All ${r.scans_total} diagnostic scans came back clean — the car has no stored faults.`
        : `${r.scans_total - r.scans_clean} of ${r.scans_total} scans found codes — check Diagnose.`,
      status: clean ? "good" : "watch",
    });
  }

  if (i.ltft_avg != null) {
    const a = Math.abs(i.ltft_avg);
    v.push({
      icon: Wrench,
      title: "Engine health",
      text:
        a < 5
          ? `Fuel trims are near zero (${i.ltft_avg.toFixed(1)}%) — the engine is breathing and fueling exactly as designed.`
          : a < 10
            ? `Fuel trims are slightly off (${i.ltft_avg.toFixed(1)}%) — nothing urgent, but worth watching the trend.`
            : `Fuel trims are far from zero (${i.ltft_avg.toFixed(1)}%) — the engine is compensating for something (possible air leak or sensor drift). Worth investigating.`,
      status: a < 5 ? "good" : a < 10 ? "watch" : "bad",
    });
  }

  if (i.coolant_max != null) {
    v.push({
      icon: Thermometer,
      title: "Cooling system",
      text: !i.coolant_reached_op
        ? `The engine hasn't reached full temperature in this period (max ${i.coolant_max.toFixed(0)}°C) — fine for short trips, but if it never reaches ~90°C on longer drives, the thermostat may be stuck open.`
        : i.coolant_max > 105
          ? `Coolant peaked at ${i.coolant_max.toFixed(0)}°C — hotter than it should ever get. Check coolant level.`
          : `Reaches proper operating temperature and never overheats (max ${i.coolant_max.toFixed(0)}°C). Thermostat and cooling system working as they should.`,
      status: !i.coolant_reached_op ? "watch" : i.coolant_max > 105 ? "bad" : "good",
    });
  }

  if (i.voltage_min != null && i.voltage_avg != null) {
    const low = i.voltage_min < 11.5;
    v.push({
      icon: BatteryCharging,
      title: "Battery & charging",
      text: low
        ? `Voltage dipped to ${i.voltage_min.toFixed(1)}V — deep dips can be normal during stop-start restarts, but if this trends down over weeks the battery is aging.`
        : `Charging system healthy. Lowest voltage seen: ${i.voltage_min.toFixed(1)}V (normal stop-start behaviour), average ${i.voltage_avg.toFixed(1)}V.`,
      status: low ? "watch" : "good",
    });
  }

  if (i.boost_max_kpa != null && i.baro_kpa != null) {
    const boost = i.boost_max_kpa - i.baro_kpa;
    if (boost > 20) {
      v.push({
        icon: Wind,
        title: "Turbo",
        text:
          boost > 80
            ? `Turbo reached ${(boost / 100).toFixed(1)} bar of boost — delivering full pressure, no signs of leaks or wastegate issues.`
            : `Turbo produced ${(boost / 100).toFixed(1)} bar of boost in this period — light driving; full-load health unknown until a harder run.`,
        status: "good",
      });
    }
  }

  return v;
}

function FuelCard({ insights: i, onPriceSaved }: { insights: Insights; onPriceSaved: () => void }) {
  const [price, setPrice] = useState(String(i.fuel_price));
  const days = i.window_hours >= 24 * 365 ? "all time" : `last ${Math.round(i.window_hours / 24)} days`;

  if (i.fuel_lph_avg == null)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Fuel className="h-4 w-4" aria-hidden="true" /> Fuel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No fuel data yet — it collects automatically on your next drive.
          </p>
        </CardContent>
      </Card>
    );

  const eur100 = i.l_per_100km != null ? i.l_per_100km * i.fuel_price : null;
  const totalCost = i.fuel_total_l != null ? i.fuel_total_l * i.fuel_price : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Fuel className="h-4 w-4" aria-hidden="true" /> Fuel — {days}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Consumption</p>
            <p className="font-mono text-xl font-semibold tabular-nums">
              {i.l_per_100km != null ? i.l_per_100km.toFixed(1) : "—"}
              <span className="ml-1 text-xs font-normal text-muted-foreground">L/100km</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cost per 100 km</p>
            <p className="font-mono text-xl font-semibold tabular-nums">
              {eur100 != null ? eur100.toFixed(2) : "—"}
              <span className="ml-1 text-xs font-normal text-muted-foreground">EUR</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fuel used (~)</p>
            <p className="font-mono text-xl font-semibold tabular-nums">
              {i.fuel_total_l != null ? i.fuel_total_l.toFixed(1) : "—"}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                L{totalCost != null ? ` · ${totalCost.toFixed(2)} EUR` : ""}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Distance (~)</p>
            <p className="font-mono text-xl font-semibold tabular-nums">
              {i.km_total != null ? i.km_total.toFixed(0) : "—"}
              <span className="ml-1 text-xs font-normal text-muted-foreground">km</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label htmlFor="fuel-price">Fuel price:</label>
          <input
            id="fuel-price"
            inputMode="decimal"
            className="h-7 w-16 rounded-md border border-border bg-card px-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <span>EUR/L</span>
          <button
            className="rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => invoke("set_fuel_price", { price: parseFloat(price) || 1.5 }).then(onPriceSaved)}
          >
            save
          </button>
          <span className="ml-2">Includes idling. ECU-reported, ±5–10%.</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function Overview() {
  const [cars, setCars] = useState<[string, number][]>([]);
  const [vin, setVin] = useState<string | null>(null);
  const [report, setReport] = useState<CarReport | null>(null);

  useEffect(() => {
    invoke<[string, number][]>("report_cars").then((c) => {
      setCars(c);
      if (c.length > 0) setVin(c[0][0]);
    });
  }, []);
  useEffect(() => {
    if (vin) invoke<CarReport>("car_report", { vin }).then(setReport).catch(() => {});
  }, [vin]);

  if (!report)
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Database className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">No data yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Connect and drive — the report builds itself from recorded sessions.
          </p>
        </CardContent>
      </Card>
    );

  const engineH = Math.floor(report.engine_minutes / 60);
  const engineM = Math.round(report.engine_minutes % 60);
  const verdicts = buildVerdicts(report);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        {cars.length > 1 ? (
          <select
            aria-label="Car"
            className="h-9 rounded-md border border-border bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={vin ?? ""}
            onChange={(e) => setVin(e.target.value)}
          >
            {cars.map(([v, n]) => (
              <option key={v} value={v}>
                {v} ({n} sessions)
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">VIN {report.vin}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Sessions", String(report.session_count)],
          ["Engine time", `${engineH}h ${engineM}m`],
          ["Readings", report.total_readings.toLocaleString()],
          ["Scans clean", `${report.scans_clean}/${report.scans_total}`],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle>{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-xl font-semibold tabular-nums">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <HeartPulse className="h-4 w-4" aria-hidden="true" /> Health summary
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {verdicts.map((v) => {
            const Icon = v.icon;
            return (
              <div key={v.title} className="flex items-start gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {v.title}{" "}
                    <Badge variant={v.status === "good" ? "ok" : v.status === "watch" ? "warn" : "error"}>
                      {v.status === "good" ? "all good" : v.status === "watch" ? "keep an eye" : "attention"}
                    </Badge>
                  </p>
                  <p className="text-sm text-muted-foreground">{v.text}</p>
                </div>
              </div>
            );
          })}
          {verdicts.length === 0 && (
            <p className="text-sm text-muted-foreground">Not enough data yet — drive a bit with Scainner connected.</p>
          )}
        </CardContent>
      </Card>

      <FuelCard
        insights={report.insights}
        onPriceSaved={() => vin && invoke<CarReport>("car_report", { vin }).then(setReport)}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <BatteryCharging className="h-4 w-4" aria-hidden="true" /> Battery — daily min / avg / max
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.daily_voltage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No voltage data yet.</p>
          ) : (
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={report.daily_voltage} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeOpacity={0.15} vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={32} />
                  <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="max" stroke="var(--primary)" strokeWidth={1} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="avg" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="min" stroke="var(--destructive)" strokeWidth={1} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
