// "Over time": one sensor's stored readings as a trend line, then the
// min/avg/max table for every sensor in the chosen window.
import { Suspense, lazy, useState } from "react";
import { Button, Card, CardSkeleton, Chip, Mono, Note, Seg, Skeleton, Table, Td, Th, Tr } from "@/components/ui";
import { Block, Reveal } from "@/motion/components";
import { GAUGES, RANGES, gaugeLabel, statLabel } from "@/shared/domain/gauges";
import { useVehicleReport } from "@/features/vehicle/queries";
import { useHistoryPoints, useReadingKeys } from "@/features/history/queries";
import { useLocale, useT } from "@/i18n";

const TrendLineChart = lazy(() => import("@/components/charts").then((m) => ({ default: m.TrendLineChart })));

type RangeKey = "1h" | "24h" | "7d" | "30d";
const RANGE_HOURS: Record<RangeKey, number> = Object.fromEntries(RANGES.map((r) => [r.label, r.hours])) as Record<RangeKey, number>;

export function Trend({ vehicleId }: { vehicleId: number | null }) {
  const t = useT();
  const { locale } = useLocale();
  const [key, setKey] = useState("voltage");
  const [range, setRange] = useState<RangeKey>("7d");
  const [statWindow, setStatWindow] = useState<"7d" | "all">("7d");

  const readingKeysQuery = useReadingKeys(vehicleId);
  const extraKeys = (readingKeysQuery.data ?? []).filter((k) => !GAUGES.some((g) => g.key === k));
  const pointsQuery = useHistoryPoints(vehicleId, key, RANGE_HOURS[range]);
  const points = pointsQuery.data ?? [];
  const meta = GAUGES.find((g) => g.key === key);
  const step = Math.max(1, Math.floor(points.length / 600));
  const data = points.filter((_, i) => i % step === 0).map((p) => ({ ...p, t: p.ts.slice(5, 16) }));

  const reportQuery = useVehicleReport(vehicleId);
  const report = reportQuery.data ?? null;
  const reportLoading = vehicleId !== null && reportQuery.isPending;
  const stats = report ? (statWindow === "7d" ? report.stats_7d : report.stats_all) : [];

  const sensorName = (k: string) => (GAUGES.some((g) => g.key === k) ? gaugeLabel(k, locale) : k.replace(/^uds_/, "").replace(/_/g, " "));

  return (
    <>
      <Block className="flex flex-wrap gap-1.5">
        {GAUGES.map((g) => (
          <Chip key={g.key} active={key === g.key} onClick={() => setKey(g.key)}>
            {gaugeLabel(g.key, locale)}
          </Chip>
        ))}
        {extraKeys.map((k) => (
          <Chip key={k} active={key === k} onClick={() => setKey(k)}>
            {sensorName(k)}
          </Chip>
        ))}
      </Block>

      <Block>
        <Card className="gap-3 px-[18px] py-4">
          <div className="flex items-end gap-3.5">
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[13.5px]">
                {sensorName(key)}
                {meta ? ` · ${meta.unit}` : ""}
              </span>
              <span className="text-[11.5px] text-neutral-500">
                {pointsQuery.isFetching ? t.history.trend.loading : t.history.trend.pointsNote(points.length)}
              </span>
            </div>
            <Seg<RangeKey>
              size="xs"
              value={range}
              onChange={setRange}
              options={(["1h", "24h", "7d", "30d"] as RangeKey[]).map((r) => ({ value: r, label: t.history.trend.ranges[r] }))}
            />
          </div>
          <div className="h-[190px] w-full">
            {pointsQuery.isPending ? (
              <Skeleton className="h-full w-full" />
            ) : pointsQuery.isError ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Note className="text-stop">{t.history.trend.couldNotLoad}</Note>
                <Button size="sm" onClick={() => pointsQuery.refetch()}>
                  {t.common.retry}
                </Button>
              </div>
            ) : data.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <Note className="max-w-[46ch] text-center">{t.history.trend.noDataForRange}</Note>
              </div>
            ) : (
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <TrendLineChart data={data} unit={meta?.unit ?? ""} label={sensorName(key)} />
              </Suspense>
            )}
          </div>
          <Reveal when={key === "voltage"} mode="fade">
            <Note className="text-[11.5px]">{t.history.trend.voltageReferenceNote}</Note>
          </Reveal>
        </Card>
      </Block>

      <Block>
        {reportLoading ? (
          <CardSkeleton title={false} rows={5} />
        ) : (
          <Card flush>
            <div className="flex items-center gap-2 border-b border-divider px-[17px] py-[13px]">
              <span className="flex-1 text-[13.5px]">{t.history.sensorRanges.cardTitle}</span>
              <Seg
                size="xs"
                value={statWindow}
                onChange={setStatWindow}
                options={[
                  { value: "7d", label: t.history.sensorRanges.last7Days },
                  { value: "all", label: t.history.sensorRanges.allTime },
                ]}
              />
            </div>
            {stats.length === 0 ? (
              <Note className="px-[17px] py-4">{t.history.sensorRanges.noDataYet}</Note>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.history.sensorRanges.sensor}</Th>
                    <Th align="right">{t.history.sensorRanges.min}</Th>
                    <Th align="right">{t.history.sensorRanges.avg}</Th>
                    <Th align="right">{t.history.sensorRanges.max}</Th>
                    <Th>{t.history.sensorRanges.samples}</Th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <Tr key={s.key}>
                      <Td>{statLabel(s.key, locale)}</Td>
                      <Td align="right"><Mono>{s.min.toFixed(1)}</Mono></Td>
                      <Td align="right"><Mono>{s.avg.toFixed(1)}</Mono></Td>
                      <Td align="right"><Mono>{s.max.toFixed(1)}</Mono></Td>
                      <Td className="text-neutral-500"><Mono>{s.n.toLocaleString(locale === "es" ? "es-ES" : "en-US")}</Mono></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </Block>
    </>
  );
}
