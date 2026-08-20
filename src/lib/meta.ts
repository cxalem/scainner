// Shared types + sensor metadata used across views.
//
// Types below are converted to Schema.Class command by command as the
// Effect migration reaches them (docs/workflows/effect-architecture/plan.md)
// — not all at once, so this file mixes plain `type` aliases (not yet
// touched) and `Schema.Class` (validated at the DeviceService boundary).
// Both are consumed the same way by views: as a type annotation. mock.ts's
// `return {...} as T` idiom works unchanged against a Schema.Class type
// (verified directly, see plan.md).
import { Schema } from "effect";

export type Live = Record<string, number>;
export type ConnStatus = { state: string; elm_version?: string | null; detail?: string | null };

export type DtcResult = {
  mil_on: boolean;
  dtc_count: number;
  stored: string[];
  pending: string[];
  permanent: string[];
  voltage?: number | null;
  freeze?: Record<string, unknown> | null;
};
export type DtcScanRow = DtcResult & { id: number; ts: string };
// Verified engine clear: the scan right before the clear and right after.
export type ObdClearOutcome = { before: DtcResult; after: DtcResult };
// Verified per-module UDS clear (before/after fault code lists).
export type ClearOutcome = { before: string[]; accepted: boolean; after: string[] };
// One row of the write audit trail (writes_log table).
export type WriteLogRow = {
  id: number;
  ts: string;
  module: string;
  action: string;
  params: Record<string, unknown>;
  before: unknown;
  after: unknown;
  outcome: "cleared" | "faults_remain" | "refused" | "error";
  error: string | null;
};
export type EcuInfo = { vin: string; protocol: string; elm_version: string };
export type HistoryPoint = { ts: string; value: number };
export type SensorReading = { pid: string; key: string; label: string; unit: string; value: number };

export type UdsModule = { key: string; label: string; req: string; resp: string; builtin: boolean };
export type UdsHit = { did: number; hex: string; ascii: string };
export type UdsProbe = {
  id: number;
  module: string;
  did: number;
  label: string;
  unit: string;
  offset: number;
  len: number;
  scale: number;
  bias: number;
  enabled: boolean;
};

export class KeyStat extends Schema.Class<KeyStat>("KeyStat")({
  key: Schema.String,
  n: Schema.Number,
  min: Schema.Number,
  avg: Schema.Number,
  max: Schema.Number,
}) {}

export class SessionRow extends Schema.Class<SessionRow>("SessionRow")({
  id: Schema.Number,
  started_at: Schema.String,
  ended_at: Schema.NullOr(Schema.String),
  readings: Schema.Number,
  max_speed: Schema.NullOr(Schema.Number),
  max_coolant: Schema.NullOr(Schema.Number),
  min_voltage: Schema.NullOr(Schema.Number),
  minutes: Schema.Number,
}) {}

export class Insights extends Schema.Class<Insights>("Insights")({
  window_hours: Schema.Number,
  engine_hours: Schema.Number,
  fuel_lph_avg: Schema.NullOr(Schema.Number),
  speed_avg: Schema.NullOr(Schema.Number),
  l_per_100km: Schema.NullOr(Schema.Number),
  fuel_total_l: Schema.NullOr(Schema.Number),
  km_total: Schema.NullOr(Schema.Number),
  ltft_avg: Schema.NullOr(Schema.Number),
  coolant_max: Schema.NullOr(Schema.Number),
  coolant_reached_op: Schema.Boolean,
  boost_max_kpa: Schema.NullOr(Schema.Number),
  baro_kpa: Schema.NullOr(Schema.Number),
  voltage_min: Schema.NullOr(Schema.Number),
  voltage_avg: Schema.NullOr(Schema.Number),
  fuel_price: Schema.Number,
  fuel_level_pct: Schema.NullOr(Schema.Number),
}) {}

export class DailyVoltage extends Schema.Class<DailyVoltage>("DailyVoltage")({
  day: Schema.String,
  min: Schema.Number,
  avg: Schema.Number,
  max: Schema.Number,
}) {}

export class CarReport extends Schema.Class<CarReport>("CarReport")({
  vin: Schema.String,
  insights: Insights,
  session_count: Schema.Number,
  engine_minutes: Schema.Number,
  total_readings: Schema.Number,
  first: Schema.NullOr(Schema.String),
  last: Schema.NullOr(Schema.String),
  scans_total: Schema.Number,
  scans_clean: Schema.Number,
  sessions: Schema.Array(SessionRow),
  stats_7d: Schema.Array(KeyStat),
  stats_all: Schema.Array(KeyStat),
  daily_voltage: Schema.Array(DailyVoltage),
}) {}

export const GAUGES: { key: string; label: string; unit: string; fmt?: (v: number) => string }[] = [
  { key: "rpm", label: "RPM", unit: "rpm", fmt: (v) => v.toFixed(0) },
  { key: "speed", label: "Speed", unit: "km/h", fmt: (v) => v.toFixed(0) },
  { key: "coolant", label: "Coolant", unit: "°C", fmt: (v) => v.toFixed(0) },
  { key: "voltage", label: "Battery", unit: "V", fmt: (v) => v.toFixed(1) },
  { key: "load", label: "Engine load", unit: "%", fmt: (v) => v.toFixed(0) },
  { key: "throttle", label: "Throttle", unit: "%", fmt: (v) => v.toFixed(0) },
  { key: "intake_temp", label: "Intake air", unit: "°C", fmt: (v) => v.toFixed(0) },
  { key: "map", label: "Manifold", unit: "kPa", fmt: (v) => v.toFixed(0) },
  { key: "stft", label: "Fuel trim (S)", unit: "%", fmt: (v) => v.toFixed(1) },
  { key: "ltft", label: "Fuel trim (L)", unit: "%", fmt: (v) => v.toFixed(1) },
  { key: "fuel_rate", label: "Fuel rate", unit: "L/h", fmt: (v) => v.toFixed(2) },
  { key: "fuel_level", label: "Fuel level", unit: "%", fmt: (v) => v.toFixed(0) },
];

export const MONITOR_LABELS: Record<string, string> = {
  misfire: "Misfire",
  fuel_system: "Fuel system",
  components: "Components",
  catalyst: "Catalyst",
  heated_catalyst: "Heated catalyst",
  evap: "EVAP system",
  secondary_air: "Secondary air",
  o2_sensor: "O2 sensors",
  o2_heater: "O2 heaters",
  egr_vvt: "EGR / VVT",
};

export const STAT_LABELS: Record<string, string> = Object.fromEntries([
  ...GAUGES.map((g) => [g.key, `${g.label} (${g.unit})`]),
  ["voltage", "Battery (V)"],
]);

export const RANGES = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
];

export const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

// ---------- pending-state phrase narration ----------
// Module-level constants (not inline arrays) so components can pass them
// straight to useCyclingLabel without retriggering its effect every render.
// No backend progress event for connect/all_sensors — these are timed
// phrases on the frontend, a deliberate scope cut (decisions-plan.md: "Keep
// the no-Rust non-goal").

export const CONNECT_PHRASES = ["Waking the dongle…", "Negotiating protocol…"] as const;

export const ALL_SENSORS_PHRASES = ["Interrogating ECU…", "Sweeping sensor PIDs…"] as const;
