// Live — the same sensors on two time scales. "Now" is the standing gauge
// set plus whatever this car's probes push, grouped and pinnable; "Over
// time" is the stored history of the same keys (views/live/Trend.tsx).
import { useMemo, useRef, useState } from "react";
import { Activity, ChartLine, ListFilter, Pin, PinOff } from "lucide-react";
import {
  Button,
  Card,

  EmptyState,
  IconButton,
  Input,
  Mono,
  Note,
  Pill,
  ProgressBar,
  Seg,
  SectionLabel,
  Table,
  Td,
  Th,
  Tr,
  useCyclingLabel,
  type PillVariant,
} from "@/components/ui";
import { Block, Reveal, Swap } from "@/motion/components";
import { GAUGES, gaugeLabel, hex4 } from "@/shared/domain/gauges";
import type { Live as LiveMap, UdsProbe } from "@scainner/core";
import { useAllSensors } from "@/features/live/queries";
import { useListProbes } from "@/features/lab/queries";
import { useLocale, useT } from "@/i18n";
import { Trend } from "@/views/live/Trend";
import { GAUGE_RANGES, percentOf } from "@/views/live/ranges";
import { usePins } from "@/views/live/pins";

type SensorState = "standard" | "verified" | "inherited" | "candidate";

type SensorDef = {
  key: string;
  name: string;
  unit: string;
  state: SensorState;
  fmt: (v: number) => string;
  range: { lo: number; hi: number } | null;
};

// A probe's live key is not spelled out anywhere the frontend can read, so
// match the two ways the backend has named them; anything unmatched is
// shown as a plain standard reading rather than given a state it may not
// have earned.
function probeFor(key: string, probes: readonly UdsProbe[]): UdsProbe | null {
  const k = key.toLowerCase();
  return (
    probes.find((p) => k === `uds_${p.module}_${hex4(p.did)}`.toLowerCase()) ??
    probes.find((p) => p.label && k.includes(p.label.toLowerCase().replace(/\s+/g, "_"))) ??
    null
  );
}

function stateOf(probe: UdsProbe | null): SensorState {
  if (!probe) return "standard";
  return probe.origin === "discovery" ? "inherited" : "verified";
}

function SensorCard({
  def,
  value,
  live,
  pinned,
  onPin,
  onOpenTrend,
  seen,
}: {
  def: SensorDef;
  value: number | undefined;
  live: boolean;
  pinned: boolean;
  onPin: () => void;
  /** Opens this same sensor in "Over time" (views/live/Trend.tsx). */
  onOpenTrend: () => void;
  /** Running min/max for keys with no declared range. */
  seen: Map<string, { lo: number; hi: number }>;
}) {
  const t = useT();
  let pct = 0;
  if (live && value !== undefined) {
    if (def.range) pct = percentOf(value, def.range.lo, def.range.hi);
    else {
      const s = seen.get(def.key) ?? { lo: value, hi: value };
      s.lo = Math.min(s.lo, value);
      s.hi = Math.max(s.hi, value);
      seen.set(def.key, s);
      pct = s.hi > s.lo ? percentOf(value, s.lo, s.hi) : 50;
    }
  }
  const pill: PillVariant = def.state;
  return (
    <Card className="gap-[7px] px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={onOpenTrend}
          title={t.live.viewOverTime}
          className="min-w-0 flex-1 truncate rounded-sm text-left text-[12px] text-neutral-400 transition-colors duration-150 hover:text-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
        >
          {def.name}
        </button>
        <IconButton icon={pinned ? PinOff : Pin} label={pinned ? t.live.unpin : t.live.pin} active={pinned} onClick={onPin} className="p-0" />
      </div>
      <div className="text-[22px] leading-none text-neutral-100">
        <Mono>{live && value !== undefined ? def.fmt(value) : "—"}</Mono>
        {def.unit && <span className="text-[12px] text-neutral-500"> {def.unit}</span>}
      </div>
      <ProgressBar value={pct} height={3} tone={def.state === "candidate" ? "candidate" : "accent"} />
      <Pill variant={pill} className="self-start">
        {t.live.state[def.state]}
      </Pill>
    </Card>
  );
}

function AllSensorsCard({ connected }: { connected: boolean }) {
  const t = useT();
  const sensorsQuery = useAllSensors();
  const rows = sensorsQuery.data ?? [];
  const reading = sensorsQuery.isFetching;
  const readingLabel = useCyclingLabel(t.live.allSensors.readingPhrases, reading, 3000);
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const shown = rows.filter((r) => !q || r.label.toLowerCase().includes(q) || r.pid.toLowerCase().includes(q));

  return (
    <Card flush>
      <div className="flex items-center gap-2.5 border-b border-divider px-4 py-3">
        <ListFilter className="h-4 w-4 shrink-0 text-accent-400" aria-hidden="true" />
        <span className="text-[13.5px]">{t.live.allSensors.title}</span>
        <span className="flex-1" />
        {sensorsQuery.dataUpdatedAt > 0 && rows.length > 0 && (
          <span className="text-[11.5px] text-neutral-500">
            {t.live.allSensors.readAt(new Date(sensorsQuery.dataUpdatedAt).toLocaleTimeString(), rows.length)}
          </span>
        )}
        <Input
          aria-label={t.live.allSensors.filterAriaLabel}
          className="min-h-0 w-[210px] py-[5px] text-[12.5px]"
          placeholder={t.live.allSensors.filterPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Button size="sm" busy={reading} disabled={!connected} onClick={() => sensorsQuery.refetch()}>
          {reading ? readingLabel : t.live.allSensors.readButton}
        </Button>
      </div>
      <Reveal when={sensorsQuery.isError} mode="fade">
        <Note className="px-4 py-2 text-stop">
          {String(sensorsQuery.error instanceof Error ? sensorsQuery.error.message : sensorsQuery.error)}
        </Note>
      </Reveal>
      {rows.length === 0 ? (
        <EmptyState icon={Activity} tone="muted" title={t.live.allSensors.emptyTitle} body={t.live.allSensors.emptyExplainer} />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>{t.live.allSensors.pid}</Th>
                <Th>{t.live.allSensors.sensor}</Th>
                <Th align="right">{t.live.allSensors.value}</Th>
                <Th>{t.live.allSensors.unit}</Th>
                <Th>{t.live.allSensors.source}</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Tr key={r.pid}>
                  <Td><Mono>{r.pid}</Mono></Td>
                  <Td>{r.label}</Td>
                  <Td align="right"><Mono>{r.value.toFixed(1)}</Mono></Td>
                  <Td className="text-neutral-500">{r.unit}</Td>
                  <Td className="text-neutral-500">{t.live.allSensors.sourceStandard}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Reveal when={shown.length === 0 && q.length > 0} mode="fade">
            <Note className="px-4 py-[18px] text-center">{t.live.allSensors.noMatch(filter.trim())}</Note>
          </Reveal>
        </>
      )}
    </Card>
  );
}

export function Live({
  live,
  connected,
  scanning = false,
  vehicleId = null,
}: {
  live: LiveMap;
  connected: boolean;
  /** A UDS scan pauses standard polling; say so instead of going stale. */
  scanning?: boolean;
  connState?: string;
  vehicleId?: number | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [mode, setMode] = useState<"now" | "trend">("now");
  // Lifted here so a "Now" card can open its own sensor in "Over time".
  const [trendKey, setTrendKey] = useState("voltage");
  const { pins, toggle } = usePins(vehicleId);
  const probesQuery = useListProbes(vehicleId);
  const probes = probesQuery.data ?? [];
  const seen = useRef(new Map<string, { lo: number; hi: number }>()).current;
  const liveOk = connected && !scanning;

  const defs = useMemo<SensorDef[]>(() => {
    const standard: SensorDef[] = GAUGES.map((g) => ({
      key: g.key,
      name: gaugeLabel(g.key, locale),
      unit: g.unit,
      state: "standard",
      fmt: g.fmt ?? ((v) => v.toFixed(1)),
      range: GAUGE_RANGES[g.key] ?? null,
    }));
    const known = new Set(GAUGES.map((g) => g.key));
    const discovered: SensorDef[] = Object.keys(live)
      .filter((k) => !known.has(k))
      .map((k) => {
        const p = probeFor(k, probes);
        return {
          key: k,
          name: p?.label ?? k.replace(/^uds_/, "").replace(/_/g, " "),
          unit: p?.unit ?? "",
          state: stateOf(p),
          fmt: (v) => v.toFixed(2),
          range: null,
        };
      });
    return [...standard, ...discovered];
  }, [live, probes, locale]);

  const groups = useMemo(() => {
    const pinned = defs.filter((d) => pins.includes(d.key));
    const standard = defs.filter((d) => d.range !== null || GAUGES.some((g) => g.key === d.key));
    const discovered = defs.filter((d) => !standard.includes(d));
    const out: { name: string; rows: SensorDef[] }[] = [];
    if (pinned.length) out.push({ name: t.live.groupPinned, rows: pinned });
    out.push({ name: t.live.groupStandard, rows: standard });
    if (discovered.length) out.push({ name: t.live.groupDiscovered, rows: discovered });
    return out;
  }, [defs, pins, t]);

  const note = mode === "trend" ? t.live.noteStored : scanning ? t.live.noteScanning : connected ? t.live.noteLive : t.live.noteOffline;

  return (
    <>
      <Block className="flex items-center gap-3">
        <Seg
          size="md"
          value={mode}
          onChange={setMode}
          options={[
            { value: "now", label: t.live.modeNow, icon: Activity },
            { value: "trend", label: t.live.modeTrend, icon: ChartLine },
          ]}
        />
        <span className="flex-1 text-[12px] text-neutral-500">{note}</span>
      </Block>

      <Swap k={mode} className="flex flex-col gap-4">
        {mode === "now" ? (
          <>
            {groups.map((g) => (
              <div key={g.name} className="flex flex-col gap-[7px]">
                <SectionLabel>{g.name}</SectionLabel>
                <div className="grid grid-cols-3 gap-[9px]">
                  {g.rows.map((d) => (
                    <SensorCard
                      key={d.key}
                      def={d}
                      value={live[d.key]}
                      live={liveOk}
                      pinned={pins.includes(d.key)}
                      onPin={() => toggle(d.key)}
                      onOpenTrend={() => {
                        setTrendKey(d.key);
                        setMode("trend");
                      }}
                      seen={seen}
                    />
                  ))}
                </div>
              </div>
            ))}
            <AllSensorsCard connected={liveOk} />
          </>
        ) : (
          <Trend vehicleId={vehicleId} sensorKey={trendKey} onSelectKey={setTrendKey} />
        )}
      </Swap>
    </>
  );
}
