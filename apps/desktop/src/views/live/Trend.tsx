// "Over time": a browsable list of every sensor this car has stored on the
// left, one sensor's trend on the right, a compare strip of up to four small
// multiples under it, and the min/avg/max table for the chosen window.
//
// The list used to be a flat chip row of every reading key; the browser
// (./SensorBrowser.tsx, list logic in ./sensor-browser.ts) groups the same
// keys by the module that answers them and shows which ones hold data.
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import type { ReadingKey } from "@scainner/core";
import { Button, Card, CardSkeleton, IconButton, Mono, Note, Seg, Skeleton, Table, Td, Th, Tr } from "@/components/ui";
import { Block, Reveal } from "@/motion/components";
import { GAUGES, RANGES, gaugeLabel, statLabel } from "@/shared/domain/gauges";
import { useVehicleReport } from "@/features/vehicle/queries";
import { useHistoryPoints, useReadingKeyDetails } from "@/features/history/queries";
import { SensorBrowser, SensorSelect } from "@/views/live/SensorBrowser";
import { useLocale, useT } from "@/i18n";

const TrendLineChart = lazy(() => import("@/components/charts").then((m) => ({ default: m.TrendLineChart })));

type RangeKey = "1h" | "24h" | "7d" | "30d";
const RANGE_HOURS: Record<RangeKey, number> = Object.fromEntries(RANGES.map((r) => [r.label, r.hours])) as Record<RangeKey, number>;
/** Four small multiples fit the column without shrinking past reading size. */
const MAX_COMPARE = 4;

/** The raw key with `uds_` and underscores dropped — the last-resort name. */
const plainKey = (key: string) => key.replace(/^uds_/, "").replace(/_/g, " ");

/** Points thinned to ~600 samples, with the axis label recharts wants. */
function chartData(points: readonly { ts: string; value: number }[]) {
  const step = Math.max(1, Math.floor(points.length / 600));
  return points.filter((_, i) => i % step === 0).map((p) => ({ ...p, t: p.ts.slice(5, 16) }));
}

function CompareTile({
  vehicleId,
  sensorKey,
  label,
  unit,
  hours,
  onOpen,
  onRemove,
  removeLabel,
}: {
  vehicleId: number | null;
  sensorKey: string;
  label: string;
  unit: string;
  hours: number;
  onOpen: () => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  const t = useT();
  const query = useHistoryPoints(vehicleId, sensorKey, hours);
  const data = chartData(query.data ?? []);
  return (
    <div className="flex flex-col gap-1 rounded-md border border-divider p-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate rounded-sm py-1 text-left text-[12px] text-neutral-400 transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
        >
          {label}
          {unit && <span className="text-neutral-600"> · {unit}</span>}
        </button>
        <IconButton icon={X} label={removeLabel} onClick={onRemove} />
      </div>
      <div className="h-[92px] w-full">
        {query.isPending ? (
          <Skeleton className="h-full w-full" />
        ) : query.isError ? (
          <Note className="text-[11.5px] text-stop">{t.history.trend.couldNotLoad}</Note>
        ) : data.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Note className="text-[11.5px]">{t.history.trend.browser.noDataInRange}</Note>
          </div>
        ) : (
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <TrendLineChart data={data} unit={unit} label={label} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export function Trend({
  vehicleId,
  sensorKey,
  onSelectKey,
}: {
  vehicleId: number | null;
  /** Lifted to Live.tsx so a "Now" row can open its own sensor here. */
  sensorKey: string;
  onSelectKey: (key: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [range, setRange] = useState<RangeKey>("7d");
  const [statWindow, setStatWindow] = useState<"7d" | "all">("7d");
  const [compared, setCompared] = useState<string[]>([]);
  const hours = RANGE_HOURS[range];

  const keysQuery = useReadingKeyDetails(vehicleId);
  const keys = useMemo(() => keysQuery.data ?? [], [keysQuery.data]);
  const byKey = useMemo(() => new Map(keys.map((k) => [k.key, k])), [keys]);

  // Labels come from the enriched keys; the gauge table names the standard
  // ones, and a key with neither gets its raw form tidied up.
  const labelOf = useCallback(
    (entry: ReadingKey) =>
      entry.label ?? (GAUGES.some((g) => g.key === entry.key) ? gaugeLabel(entry.key, locale) : plainKey(entry.key)),
    [locale],
  );
  const unitOf = useCallback((entry: ReadingKey) => entry.unit ?? GAUGES.find((g) => g.key === entry.key)?.unit ?? "", []);
  const nameOf = useCallback(
    (key: string) => {
      const entry = byKey.get(key);
      if (entry) return labelOf(entry);
      return GAUGES.some((g) => g.key === key) ? gaugeLabel(key, locale) : plainKey(key);
    },
    [byKey, labelOf, locale],
  );
  const unitFor = useCallback(
    (key: string) => {
      const entry = byKey.get(key);
      return entry ? unitOf(entry) : (GAUGES.find((g) => g.key === key)?.unit ?? "");
    },
    [byKey, unitOf],
  );

  const pointsQuery = useHistoryPoints(vehicleId, sensorKey, hours);
  const data = chartData(pointsQuery.data ?? []);
  const unit = unitFor(sensorKey);
  const name = nameOf(sensorKey);

  const reportQuery = useVehicleReport(vehicleId);
  const report = reportQuery.data ?? null;
  const reportLoading = vehicleId !== null && reportQuery.isPending;
  const stats = report ? (statWindow === "7d" ? report.stats_7d : report.stats_all) : [];

  const browserProps = {
    keys,
    selected: sensorKey,
    onSelect: onSelectKey,
    rangeHours: hours,
    labelOf,
    unitOf,
    loading: keysQuery.isPending,
    error: keysQuery.isError,
    onRetry: () => void keysQuery.refetch(),
  };

  const canCompare = compared.length < MAX_COMPARE && !compared.includes(sensorKey);
  const unpin = (key: string) => setCompared((prev) => prev.filter((k) => k !== key));

  return (
    <Block className="flex items-start gap-4 max-[900px]:flex-col">
      <div className="sticky top-4 hidden h-[min(70vh,620px)] w-[228px] shrink-0 min-[900px]:block">
        <SensorBrowser {...browserProps} />
      </div>
      <div className="w-full min-[900px]:hidden">
        <SensorSelect {...browserProps} />
      </div>

      <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
        <Card className="gap-3 px-[18px] py-4">
          <div className="flex items-end gap-3.5">
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[13.5px]">
                {name}
                {unit ? ` · ${unit}` : ""}
              </span>
              <span className="text-[11.5px] text-neutral-500">
                {pointsQuery.isFetching ? t.history.trend.loading : t.history.trend.pointsNote(pointsQuery.data?.length ?? 0)}
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
                <TrendLineChart data={data} unit={unit} label={name} />
              </Suspense>
            )}
          </div>
          <Reveal when={sensorKey === "voltage"} mode="fade">
            <Note className="text-[11.5px]">{t.history.trend.voltageReferenceNote}</Note>
          </Reveal>
        </Card>

        <Card className="gap-3 px-[18px] py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px]">{t.history.trend.compare.title}</span>
            {compared.map((key) => (
              <span key={key} className="inline-flex items-center gap-0.5 rounded-full border border-divider py-0.5 pl-3 pr-1 text-[12px]">
                <button
                  type="button"
                  onClick={() => onSelectKey(key)}
                  className="max-w-[16ch] truncate rounded-sm py-1 text-neutral-400 transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                >
                  {nameOf(key)}
                </button>
                <IconButton icon={X} label={t.history.trend.compare.remove(nameOf(key))} onClick={() => unpin(key)} />
              </span>
            ))}
            <Button
              size="sm"
              icon={Plus}
              disabled={!canCompare}
              onClick={() => setCompared((prev) => [...prev, sensorKey])}
            >
              {t.history.trend.compare.add}
            </Button>
            <span className="flex-1" />
            <span className="text-[11.5px] text-neutral-500">{t.history.trend.compare.limitNote(MAX_COMPARE)}</span>
          </div>
          {compared.length === 0 ? (
            <Note>{t.history.trend.compare.empty}</Note>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-[560px]:grid-cols-1">
              {compared.map((key) => (
                <CompareTile
                  key={key}
                  vehicleId={vehicleId}
                  sensorKey={key}
                  label={nameOf(key)}
                  unit={unitFor(key)}
                  hours={hours}
                  onOpen={() => onSelectKey(key)}
                  onRemove={() => unpin(key)}
                  removeLabel={t.history.trend.compare.remove(nameOf(key))}
                />
              ))}
            </div>
          )}
        </Card>

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
      </div>
    </Block>
  );
}
