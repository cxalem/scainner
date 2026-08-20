// Shared types + sensor metadata used across views.
//
// Every invoke-response type is a Schema.Class, validated at the
// DeviceService boundary (docs/workflows/effect-architecture/plan.md) —
// consumed the same way by views as any other type annotation. mock.ts's
// `return {...} as T` idiom works unchanged against a Schema.Class type
// (verified directly, see plan.md). `Live` stays a plain type: it's a
// listen()-event payload, not an invoke response (research.md section 8
// scopes the event-listener surface out of this migration).
import { Schema } from "effect";

// Live-event payload (from `listen("live-update", ...)`, not `invoke`) —
// stays a plain type. research.md section 8 scopes Effect's Stream module
// (the event-listener surface) out of this migration; only request/response
// invoke calls go through Schema.
export type Live = Record<string, number>;

export class ConnStatus extends Schema.Class<ConnStatus>("ConnStatus")({
  state: Schema.String,
  elm_version: Schema.optional(Schema.NullOr(Schema.String)),
  detail: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

const dtcResultFields = {
  mil_on: Schema.Boolean,
  dtc_count: Schema.Number,
  // Schema.mutable: views push/spread these into their own useState arrays
  // (Diagnose.tsx, ModuleFaults.tsx) — a plain `string[]`, like the type
  // this replaces, not Schema.Array's default `readonly string[]`.
  stored: Schema.mutable(Schema.Array(Schema.String)),
  pending: Schema.mutable(Schema.Array(Schema.String)),
  permanent: Schema.mutable(Schema.Array(Schema.String)),
  voltage: Schema.optional(Schema.NullOr(Schema.Number)),
  freeze: Schema.optional(Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.Unknown }))),
};
export class DtcResult extends Schema.Class<DtcResult>("DtcResult")(dtcResultFields) {}
export class DtcScanRow extends Schema.Class<DtcScanRow>("DtcScanRow")({
  ...dtcResultFields,
  id: Schema.Number,
  ts: Schema.String,
}) {}
// Verified engine clear: the scan right before the clear and right after.
export class ObdClearOutcome extends Schema.Class<ObdClearOutcome>("ObdClearOutcome")({
  before: DtcResult,
  after: DtcResult,
}) {}
// Verified per-module UDS clear (before/after fault code lists).
export class ClearOutcome extends Schema.Class<ClearOutcome>("ClearOutcome")({
  before: Schema.mutable(Schema.Array(Schema.String)),
  accepted: Schema.Boolean,
  after: Schema.mutable(Schema.Array(Schema.String)),
}) {}
// One row of the write audit trail (writes_log table).
export class WriteLogRow extends Schema.Class<WriteLogRow>("WriteLogRow")({
  id: Schema.Number,
  ts: Schema.String,
  module: Schema.String,
  action: Schema.String,
  params: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  before: Schema.Unknown,
  after: Schema.Unknown,
  outcome: Schema.Literal("cleared", "faults_remain", "refused", "error"),
  error: Schema.NullOr(Schema.String),
}) {}
export class EcuInfo extends Schema.Class<EcuInfo>("EcuInfo")({
  vin: Schema.String,
  protocol: Schema.String,
  elm_version: Schema.String,
}) {}
export class HistoryPoint extends Schema.Class<HistoryPoint>("HistoryPoint")({
  ts: Schema.String,
  value: Schema.Number,
}) {}
export class SensorReading extends Schema.Class<SensorReading>("SensorReading")({
  pid: Schema.String,
  key: Schema.String,
  label: Schema.String,
  unit: Schema.String,
  value: Schema.Number,
}) {}

export class UdsModule extends Schema.Class<UdsModule>("UdsModule")({
  key: Schema.String,
  label: Schema.String,
  req: Schema.String,
  resp: Schema.String,
  builtin: Schema.Boolean,
}) {}
export class UdsHit extends Schema.Class<UdsHit>("UdsHit")({
  did: Schema.Number,
  hex: Schema.String,
  ascii: Schema.String,
}) {}
export class UdsProbe extends Schema.Class<UdsProbe>("UdsProbe")({
  id: Schema.Number,
  module: Schema.String,
  did: Schema.Number,
  label: Schema.String,
  unit: Schema.String,
  offset: Schema.Number,
  len: Schema.Number,
  scale: Schema.Number,
  bias: Schema.Number,
  enabled: Schema.Boolean,
}) {}

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
