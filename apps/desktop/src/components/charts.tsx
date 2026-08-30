// The only file that imports recharts — split into its own lazy chunk so
// the charting library doesn't ride in the eager main bundle. Colors come
// from the design tokens as CSS `var()` strings (recharts passes them
// straight through to SVG attributes), never as literals.
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CarReport } from "@scainner/core";

const TICK = { fontSize: 11, fontFamily: "var(--font-mono)", fill: "var(--neutral-500)" } as const;
const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--divider)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-md)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  color: "var(--text)",
} as const;

export function BatteryChart({ data }: { data: CarReport["daily_voltage"] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--divider)" vertical={false} />
        <XAxis dataKey="day" tick={TICK} minTickGap={32} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} domain={["auto", "auto"]} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Line type="monotone" dataKey="max" stroke="var(--accent-600)" strokeWidth={1} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="avg" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="min" stroke="var(--stop)" strokeWidth={1} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** The Over-time trend: an accent line over a fading accent area, four
 *  divider gridlines, mono ticks. The line draws in on first paint. */
export function TrendLineChart({
  data,
  unit,
  label,
}: {
  data: { t: string; value: number }[];
  unit: string;
  label: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--divider)" vertical={false} horizontalCoordinatesGenerator={({ height }) => [0.2, 0.4, 0.6, 0.8].map((p) => p * height)} />
        <XAxis dataKey="t" tick={TICK} minTickGap={48} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} domain={["auto", "auto"]} axisLine={false} tickLine={false} width={44} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(v) => [`${Number(v).toFixed(1)} ${unit}`, label]}
          labelFormatter={(l) => `${l} UTC`}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="url(#trend-fill)"
          dot={false}
          isAnimationActive
          animationDuration={1100}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
