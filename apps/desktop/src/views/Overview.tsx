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
import { useNameCurrentVehicle, useVehicleReport, useVehicles } from "@/features/vehicle/queries";
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

/** The vehicle picker label: name first (the identity for VIN-less cars),
 * VIN as the fallback for unnamed-but-VIN'd ones. */
function vehicleLabel(v: { vin: string | null; display_name: string | null }): string {
  return v.display_name ?? v.vin ?? "—";
}

export function Overview({
  connState = "disconnected",
  vehicleId: connectedVehicleId = null,
  vin: connectedVin = null,
}: {
  connState?: string;
  /** The currently-connected vehicle's id, straight from ConnStatus (schema
   * v2) — the backend resolved it in the connect handshake, or reports null
   * for a genuinely unidentified vehicle. Never derived from a cache. */
  vehicleId?: number | null;
  /** Same source, for the brand emblem (VehicleScene decodes make from it). */
  vin?: string | null;
}) {
  const t = useT();
  const vehiclesQuery = useVehicles();
  const vehicles = vehiclesQuery.data ?? [];
  const [vehicleId, setVehicleId] = useState<number | null>(connectedVehicleId);
  const [draftName, setDraftName] = useState("");
  const nameVehicle = useNameCurrentVehicle();
  const sceneStatus: SceneStatus =
    connState === "connected" ? "connected" : connState === "connecting" ? "connecting" : "disconnected";

  // Adopt the connected vehicle the moment the backend resolves it; while
  // connected with an UNIDENTIFIED vehicle, force null so the honest
  // unknown-vehicle state renders instead of a previously-viewed car (the
  // live bug from 2026-08-21, now enforced at the id level).
  useEffect(() => {
    if (connState === "connected") setVehicleId(connectedVehicleId);
  }, [connState, connectedVehicleId]);

  // Browsing while disconnected: default to the most-connected vehicle.
  useEffect(() => {
    if (vehicles.length > 0 && connState !== "connected" && vehicleId == null) setVehicleId(vehicles[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiclesQuery.data, connState, vehicleId]);

  const reportQuery = useVehicleReport(vehicleId);
  const selected = vehicles.find((v) => v.id === vehicleId);
  // Emblem source: live connection's VIN wins; a picked vehicle's stored VIN
  // otherwise. Both real, neither a guess — null renders the generic badge.
  const sceneVin = connState === "connected" ? connectedVin : (selected?.vin ?? null);

  const scene = (
    <Suspense fallback={<div className="h-64 w-full animate-pulse rounded-lg bg-muted sm:h-72" />}>
      <VehicleScene status={sceneStatus} vin={sceneVin} />
    </Suspense>
  );

  // Still discovering whether any vehicle exists at all — distinct from "no
  // car found" (research.md section 2: these two used to render identically).
  if (vehiclesQuery.isPending) {
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

  // The vehicles list itself failed. Without this branch a failed fetch
  // would fall through to the "No data yet" copy below, which plan.md rule
  // 6 reserves for a successful fetch that found nothing.
  if (vehiclesQuery.isError && vehicleId == null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">{t.overview.title}</h1>
        {scene}
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <p className="font-medium">{t.overview.couldNotLoadCars}</p>
            <Button variant="outline" onClick={() => vehiclesQuery.refetch()}>
              {t.common.retry}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Connected right now, but this vehicle couldn't be identified (no VIN —
  // e.g. a pre-Mode-09 ECU, a real case, not hypothetical). Honest state
  // plus the way out: name the car, which creates its vehicle row and
  // claims everything this connection already recorded (schema v2's
  // NameVehicle flow — the supervisor re-emits conn-status with the new
  // identity, so this branch unmounts by itself once naming lands).
  if (connState === "connected" && vehicleId == null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">{t.overview.title}</h1>
        {scene}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldQuestion className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">{t.overview.unknownVehicle}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t.overview.unknownVehicleExplainer}</p>
            <div className="flex items-center gap-2">
              <input
                aria-label={t.overview.nameVehicleLabel}
                className="h-9 w-56 rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                placeholder={t.overview.nameVehiclePlaceholder}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
              />
              <Button
                onClick={() => nameVehicle.mutate({ name: draftName })}
                disabled={draftName.trim().length === 0 || nameVehicle.isPending}
              >
                {nameVehicle.isPending ? t.overview.namingVehicle : t.overview.nameVehicleAction}
              </Button>
            </div>
            {nameVehicle.isError && <p className="text-sm text-destructive">{t.overview.nameVehicleFailed}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Confirmed empty: the vehicles fetch succeeded and found none.
  if (vehicleId == null) {
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
  const modelYear = decodeModelYear(report.vin ?? undefined);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{t.overview.title}</h1>
        {vehicles.length > 1 ? (
          <select
            aria-label={t.overview.carAriaLabel}
            className="h-9 rounded-md border border-border bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={vehicleId}
            onChange={(e) => setVehicleId(Number(e.target.value))}
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {t.overview.carOption(vehicleLabel(v), v.connections)}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">
            {modelYear ? `${modelYear} · ` : ""}
            {report.display_name ?? (report.vin ? `VIN ${report.vin}` : "")}
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

      <FuelCard vehicleId={report.vehicle_id} insights={report.insights} />

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
