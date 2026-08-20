// The only file that imports recharts — split into its own lazy chunk so
// the charting library doesn't ride in the eager main bundle. Overview is
// the default view and used to pull all of recharts in on first paint
// before the user did anything (research.md section 3). Both Overview's
// battery chart and History's trend chart lazy-load from this one file, so
// Rollup keeps them in a single shared chunk (decisions-plan.md: "the
// recharts split as an in-scope step").
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CarReport } from "@/features/vehicle/schema";

export function BatteryChart({ data }: { data: CarReport["daily_voltage"] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={32} />
        <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
        <Tooltip />
        <Line type="monotone" dataKey="max" stroke="var(--primary)" strokeWidth={1} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="avg" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="min" stroke="var(--destructive)" strokeWidth={1} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

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
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={48} />
        <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
        <Tooltip
          formatter={(v) => [`${Number(v).toFixed(1)} ${unit}`, label]}
          labelFormatter={(l) => `${l} UTC`}
        />
        <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
