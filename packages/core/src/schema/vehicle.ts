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
  // Schema v2 (docs/workflows/data-core/plan.md): the vehicle entity's id is
  // the key; vin is a nullable attribute (a real ~2000 Peugeot's ECU never
  // answers Mode 09) and display_name is the human identity for VIN-less cars.
  vehicle_id: Schema.Number,
  vin: Schema.NullOr(Schema.String),
  display_name: Schema.NullOr(Schema.String),
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

/// One row of the vehicle picker (`list_vehicles`).
export class VehicleListRow extends Schema.Class<VehicleListRow>("VehicleListRow")({
  id: Schema.Number,
  vin: Schema.NullOr(Schema.String),
  display_name: Schema.NullOr(Schema.String),
  connections: Schema.Number,
}) {}

/// The full vehicles row (`vehicle_info`) — Vehicle.tsx's identity card.
export class VehicleInfo extends Schema.Class<VehicleInfo>("VehicleInfo")({
  id: Schema.Number,
  vin: Schema.NullOr(Schema.String),
  display_name: Schema.NullOr(Schema.String),
  make: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  year: Schema.NullOr(Schema.Number),
  trim: Schema.NullOr(Schema.String),
  fuel_price: Schema.Number,
  created_at: Schema.String,
  first_connected_at: Schema.NullOr(Schema.String),
}) {}

export class EcuInfo extends Schema.Class<EcuInfo>("EcuInfo")({
  vin: Schema.String,
  protocol: Schema.String,
  elm_version: Schema.String,
}) {}
