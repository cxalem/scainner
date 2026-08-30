// Overview — what the app knows about this car right now, and what it
// thinks you should do about it. Scene + verdict up top, four stat tiles,
// fuel and recent sessions below. Every section is a <Block> so the page
// stagger and sibling reflow come from the shared motion vocabulary.
import { Suspense, lazy, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Cable,
  Database,
  History,
  ShieldCheck,
  ShieldQuestion,
  Timer,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { Button, Card, CardHead, CardSkeleton, EmptyState, Field, Input, Mono, Pill, Skeleton } from "@/components/ui";
import { Block } from "@/motion/components";
import type { SceneStatus } from "@/components/VehicleScene";
import { useNameCurrentVehicle, useVehicleReport, useVehicles } from "@/features/vehicle/queries";
import { buildVerdicts } from "@/views/overview/buildVerdicts";
import { FuelCard } from "@/views/overview/FuelCard";
import { useLocale, useT } from "@/i18n";

// Code-split: three.js only loads once the scene actually mounts.
const VehicleScene = lazy(() =>
  import("@/components/VehicleScene").then((m) => ({ default: m.VehicleScene })),
);

// Fixed, not h-full: with the grid no longer stretching this cell to match
// its sibling (see hero() below), the frame needs its own definite height
// for the WebGL canvas to size against — h-full has nothing to resolve
// against once the parent's height is content-driven instead of stretched.
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
  onNavigate,
}: {
  connState?: string;
  /** The vehicle every view shows — resolved once in App.tsx. */
  vehicleId?: number | null;
  /** VIN for the brand emblem (VehicleScene decodes make from it). */
  vin?: string | null;
  onNavigate?: (view: "diagnose" | "live") => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const vehiclesQuery = useVehicles();
  const [draftName, setDraftName] = useState("");
  const nameVehicle = useNameCurrentVehicle();
  const sceneStatus: SceneStatus =
    connState === "connected" ? "connected" : connState === "connecting" ? "connecting" : "disconnected";
  const reportQuery = useVehicleReport(vehicleId);

  const hero = (right: ReactNode) => (
    // items-start, not items-stretch: the verdict card's line count varies
    // (1 sentence to 5 bullets), and stretching the scene card to match
    // turns its 300×190 landscape frame into a near-square or portrait
    // box — the emblem's camera is tuned for landscape, so a stretched
    // frame renders it as a thin vertical sliver instead of the full mark.
    // Left top-aligned at its own min-height; the right card grows freely.
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

  // Still discovering whether any vehicle exists at all.
  if (vehiclesQuery.isPending) {
    return (
      <>
        {hero(<CardSkeleton rows={4} />)}
        {tilesSkeleton}
      </>
    );
  }

  if (vehiclesQuery.isError && vehicleId == null) {
    return hero(
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
    );
  }

  // Connected, but this car answered no VIN: name it to create its row.
  if (connState === "connected" && vehicleId == null) {
    return hero(
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
    );
  }

  // Confirmed empty: the fetch succeeded and found nothing.
  if (vehicleId == null) {
    return hero(
      <Card className="justify-center">
        <EmptyState icon={Database} tone="muted" title={t.overview.noDataYet} body={t.overview.noDataYetExplainer} />
      </Card>,
    );
  }

  if (reportQuery.isPending) {
    return (
      <>
        {hero(<CardSkeleton rows={4} />)}
        {tilesSkeleton}
        <Block className="grid grid-cols-2 gap-3">
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </Block>
      </>
    );
  }

  if (reportQuery.isError || !reportQuery.data) {
    return hero(
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
    );
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
  // One compact line about the scan specifically (not the full per-check
  // detail list, which Diagnose already owns) — the fault-record verdict
  // buildVerdicts also computes, reused directly rather than duplicated.
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

  return (
    <>
      {/* h-[190px], not h-full: matches SCENE_CLASS's own fixed height now
          that the grid is items-start (each cell sizes to its own content,
          see hero() below) — two independent-height cards side by side
          need an explicit shared height, not mutual stretching, or one
          crops the other's aspect (2026-08-30). justify-between spreads
          the now-shorter content across that height instead of leaving it
          bunched in the middle with dead space top and bottom. */}
      {hero(
        <Card className="h-[190px] justify-between gap-3 px-[18px] py-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Pill variant={chip.variant} className="text-[11px]">{chip.text}</Pill>
              <span className="text-[12px] text-neutral-500">{scanNote}</span>
            </div>
            {/* A quick overview, not a report: headline + one line about
                the scan specifically. The full per-check detail list
                (buildVerdicts' other lines: engine/cooling/battery/turbo)
                stays out of this card — too much for a glanceable summary;
                Diagnose already owns the itemized version (2026-08-30). */}
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
                {/* min-w, not w: toLocaleString's real output ("Aug 25,
                    6:31 PM") runs longer than the design's terse "14:02" —
                    a fixed w would paint over the text beside it. */}
                <Mono className="min-w-[74px] shrink-0 text-[11.5px] text-neutral-500">{formatWhen(s.started_at, locale)}</Mono>
                <span className="text-neutral-300">{t.overview.sessions.row(s.minutes, s.readings)}</span>
              </div>
            ))
          )}
        </Card>
      </Block>
    </>
  );
}
