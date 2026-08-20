// Response types for the vehicle-identity/car-report surface: Overview's
// dashboard, History's stat tables, and Vehicle.tsx's identity card all
// consume these (research.md section 3 — feature folders match this app's
// real view boundaries, not an arbitrary split).
import { Schema } from "effect";

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

export class EcuInfo extends Schema.Class<EcuInfo>("EcuInfo")({
  vin: Schema.String,
  protocol: Schema.String,
  elm_version: Schema.String,
}) {}
