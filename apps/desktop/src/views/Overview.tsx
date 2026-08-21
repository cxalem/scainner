import { Suspense, lazy, useEffect, useState } from "react";
import {
  AlertTriangle,
  BatteryCharging,
  ClipboardList,
  Database,
  HeartPulse,
  History,
  ShieldQuestion,
  Timer,
} from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, CardSkeleton, Skeleton } from "@/components/ui";
import type { SceneStatus } from "@/components/VehicleScene";
import { decodeModelYear } from "@/lib/vin";
import { useCarReport, useReportCars } from "@/features/vehicle/queries";
import { buildVerdicts } from "@/views/overview/buildVerdicts";
import { FuelCard } from "@/views/overview/FuelCard";
import { useT } from "@/i18n";

// Code-split: pulls in three.js/@react-three (~450KB gzip) only once
// Overview actually mounts the scene, not on initial app load — Overview is
// the default view, unlike Vehicle/DiscoveryFlow which are already lazy at
// the App.tsx level, so this needs its own lazy boundary.
const VehicleScene = lazy(() =>
  import("@/components/VehicleScene").then((m) => ({ default: m.VehicleScene })),
);
// Same reasoning, for recharts (see src/components/charts.tsx).
const BatteryChart = lazy(() => import("@/components/charts").then((m) => ({ default: m.BatteryChart })));

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
  const t = useT();
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

  // A fresh connection whose VIN genuinely couldn't be read (App.tsx's
  // conn.vin is null — e.g. an older, pre-Mode-09 ECU, not just a
  // transient failure) must not keep showing whatever car was on screen
  // before. Without this, `vin` state below stays stuck on a PREVIOUS
  // car's VIN (from an earlier connect, or the cars[0] fallback further
  // down) and silently renders as if it were the one connected right now
  // — exactly the bug caught live 2026-08-21 on a real ~2000 Peugeot: the
  // Citroën's emblem and report stayed on screen the whole time it was
  // connected. Explicitly clearing `vin` here is what lets the "unknown
  // vehicle" branch below render honestly instead.
  useEffect(() => {
    if (connState === "connected" && !connectedVin) setVin(null);
  }, [connState, connectedVin]);

  // Runs whenever the cars list resolves (fresh mount, or a background
  // revalidation after connect/discovery invalidates it) and picks the
  // first car when nothing more specific is known yet — but only when
  // nothing is actively connected right now. While genuinely connected
  // with an unknown VIN, falling back to some other car's history here
  // would repeat the exact same bug the effect above just guarded
  // against, just from a different trigger (this one firing on mount
  // before the connect effect above has run yet).
  useEffect(() => {
    if (cars.length > 0 && !connectedVin && connState !== "connected") setVin(cars[0][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carsQuery.data, connectedVin, connState]);

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
        <h1 className="text-lg font-semibold tracking-tight">{t.overview.title}</h1>
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
        <h1 className="text-lg font-semibold tracking-tight">{t.overview.title}</h1>
        {scene}
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <p className="font-medium">{t.overview.couldNotLoadCars}</p>
            <Button variant="outline" onClick={() => carsQuery.refetch()}>
              {t.common.retry}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Connected right now, but this vehicle's VIN genuinely couldn't be read
  // (App.tsx's conn.vin is null — see its doc comment) — distinct from "no
  // car has ever been recorded" below, and checked first so it takes
  // priority. Honest, not a guess: no brand emblem (VehicleScene already
  // falls back to a generic nameplate for a null vin), no report from some
  // OTHER car standing in for this one.
  if (connState === "connected" && !effectiveVin) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">{t.overview.title}</h1>
        {scene}
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ShieldQuestion className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">{t.overview.unknownVehicle}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t.overview.unknownVehicleExplainer}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Confirmed empty: the cars fetch succeeded and found none.
  if (!effectiveVin) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">{t.overview.title}</h1>
        {scene}
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Database className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">{t.overview.noDataYet}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t.overview.noDataYetExplainer}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (reportQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">{t.overview.title}</h1>
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
        <h1 className="text-lg font-semibold tracking-tight">{t.overview.title}</h1>
        {scene}
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <p className="font-medium">{t.overview.couldNotLoadReport}</p>
            <Button variant="outline" onClick={() => reportQuery.refetch()}>
              {t.common.retry}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const report = reportQuery.data;
  const engineH = Math.floor(report.engine_minutes / 60);
  const engineM = Math.round(report.engine_minutes % 60);
  const verdicts = buildVerdicts(report, t);
  // Model year only — see src/lib/vin.ts for why the full model/trim isn't
  // here too, that needs a per-brand table this app doesn't have.
  const modelYear = decodeModelYear(report.vin);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{t.overview.title}</h1>
        {cars.length > 1 ? (
          <select
            aria-label={t.overview.carAriaLabel}
            className="h-9 rounded-md border border-border bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={vin ?? ""}
            onChange={(e) => setVin(e.target.value)}
          >
            {cars.map(([v, n]) => (
              <option key={v} value={v}>
                {t.overview.carOption(v, n)}
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
          { label: t.overview.stats.sessions, value: String(report.session_count), icon: History },
          { label: t.overview.stats.engineTime, value: `${engineH}h ${engineM}m`, icon: Timer },
          { label: t.overview.stats.readings, value: report.total_readings.toLocaleString(), icon: Database },
          { label: t.overview.stats.scansClean, value: `${report.scans_clean}/${report.scans_total}`, icon: ClipboardList },
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
            <HeartPulse className="h-4 w-4" aria-hidden="true" /> {t.overview.health.cardTitle}
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
                      {v.status === "good"
                        ? t.overview.health.statusGood
                        : v.status === "watch"
                          ? t.overview.health.statusWatch
                          : t.overview.health.statusBad}
                    </Badge>
                  </p>
                  <p className="text-sm text-muted-foreground">{v.text}</p>
                </div>
              </div>
            );
          })}
          {verdicts.length === 0 && <p className="text-sm text-muted-foreground">{t.overview.health.notEnoughData}</p>}
        </CardContent>
      </Card>

      <FuelCard insights={report.insights} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <BatteryCharging className="h-4 w-4" aria-hidden="true" /> {t.overview.battery.cardTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.daily_voltage.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.overview.battery.noData}</p>
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
