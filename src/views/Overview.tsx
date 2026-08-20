import { Suspense, lazy, useEffect, useState } from "react";
import {
  AlertTriangle,
  BatteryCharging,
  ClipboardList,
  Database,
  Fuel,
  HeartPulse,
  History,
  Thermometer,
  Timer,
  Wind,
  Wrench,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSkeleton,
  Skeleton,
  useTransientLabel,
} from "@/components/ui";
import type { SceneStatus } from "@/components/VehicleScene";
import type { CarReport, Insights } from "@/lib/meta";
import { decodeModelYear } from "@/lib/vin";
import { useCarReport, useReportCars, useSetFuelPrice } from "@/lib/queries";

// Code-split: pulls in three.js/@react-three (~450KB gzip) only once
// Overview actually mounts the scene, not on initial app load — Overview is
// the default view, unlike Vehicle/DiscoveryFlow which are already lazy at
// the App.tsx level, so this needs its own lazy boundary.
const VehicleScene = lazy(() =>
  import("@/components/VehicleScene").then((m) => ({ default: m.VehicleScene })),
);
// Same reasoning, for recharts (see src/components/charts.tsx).
const BatteryChart = lazy(() => import("@/components/charts").then((m) => ({ default: m.BatteryChart })));

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

function fuelStatus(pct: number): { label: string; tone: "good" | "watch" | "bad" } {
  if (pct < 10) return { label: "Reserve", tone: "bad" };
  if (pct < 25) return { label: "Low", tone: "watch" };
  if (pct >= 90) return { label: "Full", tone: "good" };
  return { label: "Good", tone: "good" };
}

/** Visual tank gauge — the most recent reading, not a window average (a tank
 * level is a point-in-time fact, not a trend). Not every ECU reports this
 * PID over standard OBD2; the card degrades gracefully when it's absent. */
function FuelLevelGauge({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const status = fuelStatus(clamped);
  const fillColor =
    status.tone === "bad" ? "bg-destructive" : status.tone === "watch" ? "bg-warn" : "bg-primary";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-3xl font-semibold tabular-nums">
          {clamped.toFixed(0)}
          <span className="ml-1 text-sm font-normal text-muted-foreground">%</span>
        </p>
        <Badge variant={status.tone === "good" ? "ok" : status.tone === "watch" ? "warn" : "error"}>
          {status.label}
        </Badge>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Fuel tank ${clamped.toFixed(0)} percent, ${status.label.toLowerCase()}`}>
        {/* quarter-tick marks */}
        {[25, 50, 75].map((t) => (
          <span key={t} className="absolute inset-y-0 w-px bg-foreground/15" style={{ left: `${t}%` }} aria-hidden="true" />
        ))}
        <div
          className={`h-full origin-left rounded-full ${fillColor} motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-reduce:transition-none`}
          style={{ transform: `scaleX(${clamped / 100})`, width: "100%" }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>E</span>
        <span>F</span>
      </div>
    </div>
  );
}

function FuelCard({ insights: i }: { insights: Insights }) {
  const [price, setPrice] = useState(String(i.fuel_price));
  const setFuelPrice = useSetFuelPrice();
  const [savedLabel, flashSaved] = useTransientLabel();
  const days = i.window_hours >= 24 * 365 ? "all time" : `last ${Math.round(i.window_hours / 24)} days`;
  const hasLevel = i.fuel_level_pct != null;
  const hasConsumption = i.fuel_lph_avg != null;

  if (!hasLevel && !hasConsumption)
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
          <Fuel className="h-4 w-4" aria-hidden="true" /> Fuel{hasConsumption ? ` — ${days}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hasLevel && <FuelLevelGauge pct={i.fuel_level_pct!} />}
        {!hasLevel && hasConsumption && (
          // Honest absence beats silent absence. Verified against real data:
          // the C4 answered every polled PID thousands of times except fuel
          // level (PID 012F), zero answers ever. PSA keeps tank level in the
          // BSI body computer, which is not reachable over standard OBD2 or
          // this dongle's UDS path (see UDS_INVESTIGATION_LOG.md).
          <p className="text-xs text-muted-foreground">
            This car does not report its tank level over standard OBD2, so there is no fuel gauge here.
            Consumption below comes from the engine and works normally.
          </p>
        )}

        {hasConsumption ? (
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
        ) : (
          <p className="text-sm text-muted-foreground">
            Consumption stats collect automatically on your next drive.
          </p>
        )}

        {hasConsumption && (
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
              className="rounded text-primary hover:underline disabled:pointer-events-none disabled:opacity-50 transition-transform active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              disabled={setFuelPrice.isPending}
              onClick={() =>
                setFuelPrice.mutate(
                  { price: parseFloat(price) || 1.5 },
                  { onSuccess: () => flashSaved("saved") },
                )
              }
            >
              {setFuelPrice.isPending ? "saving…" : savedLabel === "saved" ? "saved" : "save"}
            </button>
            {setFuelPrice.isError && <span className="text-destructive">Could not save. Try again.</span>}
            <span className="ml-2">Includes idling. ECU-reported, ±5–10%.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Overview({
  connState = "disconnected",
  vin: connectedVin = null,
}: {
  connState?: string;
  /** The currently-connected car's VIN, from App — known earlier than
   * Overview's own report_cars fetch below, so the emblem shows the right
   * brand on Overview's first render instead of flashing a generic badge
   * while report_cars catches up (App resolves this in the same handler
   * that drives connState in the first place). */
  vin?: string | null;
}) {
  const carsQuery = useReportCars();
  const cars = carsQuery.data ?? [];
  const [vin, setVin] = useState<string | null>(connectedVin);
  const sceneStatus: SceneStatus =
    connState === "connected" ? "connected" : connState === "connecting" ? "connecting" : "disconnected";

  // Adopt App's faster-known VIN the moment it changes (a new connect), but
  // only ever move forward from it — report_cars below or the car picker
  // can still take vin in a different direction afterward (a different car
  // selected from the dropdown), this just seeds the very first paint.
  useEffect(() => {
    if (connectedVin) setVin(connectedVin);
  }, [connectedVin]);

  // Runs whenever the cars list resolves (fresh mount, or a background
  // revalidation after connect/discovery invalidates it) and picks the
  // first car when nothing more specific (App's connectedVin) is known yet
  // — same behavior the old refreshKey-keyed effect had.
  useEffect(() => {
    if (cars.length > 0 && !connectedVin) setVin(cars[0][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carsQuery.data, connectedVin]);

  const effectiveVin = vin ?? connectedVin;
  const reportQuery = useCarReport(effectiveVin);

  const scene = (
    <Suspense fallback={<div className="h-64 w-full animate-pulse rounded-lg bg-muted sm:h-72" />}>
      <VehicleScene status={sceneStatus} vin={effectiveVin} />
    </Suspense>
  );

  // Still discovering whether any car exists at all — distinct from "no car
  // found" (research.md section 2: these two used to render identically).
  if (carsQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        {scene}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} rows={1} />
          ))}
        </div>
        <CardSkeleton rows={4} />
      </div>
    );
  }

  // The cars list itself failed. Without this branch a failed fetch would
  // fall through to the "No data yet" copy below, which plan.md rule 6
  // reserves for a successful fetch that found nothing.
  if (carsQuery.isError && !effectiveVin) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        {scene}
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <p className="font-medium">Could not load the car list.</p>
            <Button variant="outline" onClick={() => carsQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Confirmed empty: the cars fetch succeeded and found none.
  if (!effectiveVin) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        {scene}
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Database className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">No data yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Connect and drive — the report builds itself from recorded sessions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (reportQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        {scene}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} rows={1} />
          ))}
        </div>
        <CardSkeleton rows={4} />
        <CardSkeleton rows={4} />
        <CardSkeleton contentClassName="h-44" />
      </div>
    );
  }

  if (reportQuery.isError || !reportQuery.data) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        {scene}
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <p className="font-medium">Could not load this car's report.</p>
            <Button variant="outline" onClick={() => reportQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const report = reportQuery.data;
  const engineH = Math.floor(report.engine_minutes / 60);
  const engineM = Math.round(report.engine_minutes % 60);
  const verdicts = buildVerdicts(report);
  // Model year only — see src/lib/vin.ts for why the full model/trim isn't
  // here too, that needs a per-brand table this app doesn't have.
  const modelYear = decodeModelYear(report.vin);

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
          <span className="font-mono text-xs text-muted-foreground">
            {modelYear ? `${modelYear} · ` : ""}
            VIN {report.vin}
          </span>
        )}
      </div>

      {scene}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Sessions", value: String(report.session_count), icon: History },
          { label: "Engine time", value: `${engineH}h ${engineM}m`, icon: Timer },
          { label: "Readings", value: report.total_readings.toLocaleString(), icon: Database },
          { label: "Scans clean", value: `${report.scans_clean}/${report.scans_total}`, icon: ClipboardList },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
              </CardTitle>
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

      <FuelCard insights={report.insights} />

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
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <BatteryChart data={report.daily_voltage} />
              </Suspense>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
