import { Suspense, lazy, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Cable,
  Database,
  History,
  Radar,
  ShieldCheck,
  ShieldQuestion,
  Timer,
  Waves,
  X,
  type LucideIcon,
} from "lucide-react";
import { Banner, Button, Card, CardHead, CardSkeleton, EmptyState, Field, IconButton, Input, Mono, Pill, Skeleton } from "@/components/ui";
import { Block, Reveal } from "@/motion/components";
import type { SceneStatus } from "@/components/VehicleScene";
import { useNameCurrentVehicle, useVehicleReport, useVehicles } from "@/features/vehicle/queries";
import { buildVerdicts } from "@/views/overview/buildVerdicts";
import { FuelCard } from "@/views/overview/FuelCard";
import { useLocale, useT } from "@/i18n";
import { Button as RideButton } from "@/components/ui/button";
import { discoveryRunId, showDiscoveryBanner } from "@/lib/discovery-notice";
import type { DiscoveryStatus } from "@scainner/core";

const VehicleScene = lazy(() =>
  import("@/components/VehicleScene").then((m) => ({ default: m.VehicleScene })),
);

const SCENE_CLASS = "h-[190px] rounded-none";

function SceneCard({ status, vin }: { status: SceneStatus; vin: string | null }) {
  return (
    <div className="flex h-[190px] overflow-hidden rounded-md border border-divider bg-surface shadow-sm">
      <Suspense fallback={<Skeleton className="h-[190px] w-full rounded-none" />}>
        <VehicleScene status={status} vin={vin} className={SCENE_CLASS} background="light" />
      </Suspense>
    </div>
  );
}

function formatWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function Overview({
  connState = "disconnected",
  vehicleId = null,
  vin = null,
  discovery = null,
  onNavigate,
  onStartRide,
  canStartRide = false,
}: {
  connState?: string;
  vehicleId?: number | null;
  vin?: string | null;
  discovery?: DiscoveryStatus | null;
  onNavigate?: (view: "diagnose" | "live" | "lab") => void;
  onStartRide?: () => void;
  canStartRide?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const vehiclesQuery = useVehicles();
  const [draftName, setDraftName] = useState("");
  const nameVehicle = useNameCurrentVehicle();
  const sceneStatus: SceneStatus =
    connState === "connected" ? "connected" : connState === "connecting" ? "connecting" : "disconnected";
  const reportQuery = useVehicleReport(vehicleId);
  const [dismissedRun, setDismissedRun] = useState<string | null>(null);
  const scanBanner = showDiscoveryBanner(discovery, dismissedRun);
  const withScanBanner = (content: ReactNode) => (
    <>
      <Reveal when={scanBanner} mode="fade">
        <Banner
          tone="info"
          icon={Radar}
          className="rounded-md"
          action={
            <span className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => onNavigate?.("lab")}>
                {t.autoScan.banner.action}
              </Button>
              <IconButton
                icon={X}
                label={t.autoScan.banner.dismiss}
                onClick={() => setDismissedRun(discoveryRunId(discovery))}
              />
            </span>
          }
        >
          <span className="block text-[13px] text-neutral-300">{t.autoScan.banner.title}</span>
          <span className="block text-[12px] text-neutral-500">{t.autoScan.banner.line}</span>
        </Banner>
      </Reveal>
      {content}
    </>
  );

  const hero = (right: ReactNode) => (
    <Block className="grid items-start gap-4" style={{ gridTemplateColumns: "300px 1fr" }}>
      <SceneCard status={sceneStatus} vin={vin} />
      {right}
    </Block>
  );

  const tilesSkeleton = (
    <Block className="grid grid-cols-4 gap-2.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <CardSkeleton key={i} rows={1} />
      ))}
    </Block>
  );

  if (vehiclesQuery.isPending) {
    return withScanBanner((
      <>
        {hero(<CardSkeleton rows={4} />)}
        {tilesSkeleton}
      </>
    ));
  }

  if (vehiclesQuery.isError && vehicleId == null) {
    return withScanBanner(hero(
      <Card>
        <EmptyState
          icon={AlertTriangle}
          tone="muted"
          title={t.overview.couldNotLoadCars}
          action={
            <Button variant="secondary" size="sm" onClick={() => vehiclesQuery.refetch()}>
              {t.common.retry}
            </Button>
          }
        />
      </Card>,
    ));
  }

  if (connState === "connected" && vehicleId == null) {
    return withScanBanner(hero(
      <Card className="justify-center">
        <EmptyState
          icon={ShieldQuestion}
          tone="muted"
          title={t.overview.unknownVehicle}
          body={t.overview.unknownVehicleExplainer}
          action={
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (draftName.trim()) nameVehicle.mutate({ name: draftName });
              }}
            >
              <Field label={t.overview.nameVehicleLabel} htmlFor="ov-name" className="w-56 text-left">
                <Input
                  id="ov-name"
                  placeholder={t.overview.nameVehiclePlaceholder}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                busy={nameVehicle.isPending}
                disabled={draftName.trim().length === 0}
              >
                {nameVehicle.isPending ? t.overview.namingVehicle : t.overview.nameVehicleAction}
              </Button>
            </form>
          }
        />
        {nameVehicle.isError && <p className="text-center text-[12px] text-stop">{t.overview.nameVehicleFailed}</p>}
      </Card>,
    ));
  }

  if (vehicleId == null) {
    return withScanBanner(hero(
      <Card className="justify-center">
        <EmptyState icon={Database} tone="muted" title={t.overview.noDataYet} body={t.overview.noDataYetExplainer} />
      </Card>,
    ));
  }

  if (reportQuery.isPending) {
    return withScanBanner((
      <>
        {hero(<CardSkeleton rows={4} />)}
        {tilesSkeleton}
        <Block className="grid grid-cols-2 gap-3">
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </Block>
      </>
    ));
  }

  if (reportQuery.isError || !reportQuery.data) {
    return withScanBanner(hero(
      <Card>
        <EmptyState
          icon={AlertTriangle}
          tone="muted"
          title={t.overview.couldNotLoadReport}
          action={
            <Button variant="secondary" size="sm" onClick={() => reportQuery.refetch()}>
              {t.common.retry}
            </Button>
          }
        />
      </Card>,
    ));
  }

  const report = reportQuery.data;
  const engineH = Math.floor(report.engine_minutes / 60);
  const engineM = Math.round(report.engine_minutes % 60);
  const verdicts = buildVerdicts(report, t);
  const worst = verdicts.some((v) => v.status === "bad")
    ? "bad"
    : verdicts.some((v) => v.status === "watch")
      ? "watch"
      : verdicts.length > 0
        ? "good"
        : "none";
  const chip =
    worst === "bad"
      ? { variant: "stop" as const, text: t.overview.verdict.chipBad }
      : worst === "watch"
        ? { variant: "warn" as const, text: t.overview.verdict.chipWatch }
        : worst === "good"
          ? { variant: "ok" as const, text: t.overview.verdict.chipGood }
          : { variant: "info" as const, text: t.overview.verdict.chipNone };
  const headline =
    worst === "none"
      ? connState === "connected"
        ? t.overview.verdict.headNoDataConnected
        : t.overview.verdict.headNoData
      : worst === "good"
        ? t.overview.verdict.headGood
        : t.overview.verdict.headIssues(verdicts.filter((v) => v.status !== "good").length);
  const scanNote =
    report.scans_total > 0 ? t.overview.verdict.scanNote(report.scans_total, report.last ? formatWhen(report.last, locale) : null) : t.overview.verdict.noScanNote;
  const scanInfo =
    report.scans_total > 0
      ? {
          clean: report.scans_clean === report.scans_total,
          text:
            report.scans_clean === report.scans_total
              ? t.overview.health.faultRecordClean(report.scans_total)
              : t.overview.health.faultRecordSome(report.scans_total - report.scans_clean, report.scans_total),
        }
      : null;

  const tiles: { icon: LucideIcon; label: string; value: string; note: string }[] = [
    {
      icon: Cable,
      label: t.overview.stats.sessions,
      value: String(report.session_count),
      note: report.first ? t.overview.stats.firstSeen(formatWhen(report.first, locale)) : t.overview.stats.noSessions,
    },
    { icon: Timer, label: t.overview.stats.engineTime, value: `${engineH} h ${engineM} m`, note: t.overview.stats.engineTimeNote(t.shell.appName) },
    { icon: Waves, label: t.overview.stats.readings, value: report.total_readings.toLocaleString(locale), note: t.overview.stats.readingsNote },
    {
      icon: ShieldCheck,
      label: t.overview.stats.scansClean,
      value: t.overview.stats.scansCleanValue(report.scans_clean, report.scans_total),
      note: t.overview.stats.scansCleanNote,
    },
  ];

  return withScanBanner((
    <>
      {hero(
        <Card className="h-[190px] justify-between gap-3 px-[18px] py-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Pill variant={chip.variant} className="text-[11px]">{chip.text}</Pill>
              <span className="text-[12px] text-neutral-500">{scanNote}</span>
            </div>
            <div className="max-w-[38ch] text-[19px] leading-[1.35]">{headline}</div>
            {scanInfo && (
              <div className="flex items-start gap-2 text-[13px] leading-[1.5]">
                {scanInfo.clean ? (
                  <ShieldCheck className="mt-0.5 h-[15px] w-[15px] shrink-0 text-ok" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-[15px] w-[15px] shrink-0 text-warn" aria-hidden="true" />
                )}
                <span className="text-neutral-300">{scanInfo.text}</span>
              </div>
            )}
          </div>
          {onNavigate && (
            <div className="flex gap-2">
              {canStartRide ? <RideButton className="min-h-10" size="sm" onClick={onStartRide}>{t.ride.record}</RideButton> : null}
              <Button variant="primary" size="sm" onClick={() => onNavigate("diagnose")}>
                {t.overview.verdict.openFaults}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onNavigate("live")}>
                {t.overview.verdict.watchLive}
              </Button>
            </div>
          )}
        </Card>,
      )}

      <Block className="grid grid-cols-4 gap-2.5">
        {tiles.map(({ icon: Icon, label, value, note }) => (
          <Card key={label} className="gap-[5px] px-[15px] py-[13px]">
            <div className="flex items-center gap-[7px]">
              <Icon className="h-3.5 w-3.5 text-accent-600" aria-hidden="true" />
              <span className="text-[11px] uppercase tracking-[0.06em] text-neutral-500">{label}</span>
            </div>
            <Mono className="text-[23px] leading-tight text-neutral-100">{value}</Mono>
            <span className="text-[11.5px] text-neutral-500">{note}</span>
          </Card>
        ))}
      </Block>

      <Block className="grid grid-cols-2 gap-3">
        <FuelCard vehicleId={report.vehicle_id} insights={report.insights} live={connState === "connected"} />
        <Card className="gap-[9px]">
          <CardHead icon={History} title={t.overview.sessions.cardTitle} />
          {report.sessions.length === 0 ? (
            <span className="text-[12.5px] text-neutral-500">{t.overview.sessions.none}</span>
          ) : (
            report.sessions.slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-baseline gap-[11px] text-[12.5px]">
                <Mono className="min-w-[74px] shrink-0 text-[11.5px] text-neutral-500">{formatWhen(s.started_at, locale)}</Mono>
                <span className="text-neutral-300">{t.overview.sessions.row(s.minutes, s.readings)}</span>
              </div>
            ))
          )}
        </Card>
      </Block>
    </>
  ));
}
