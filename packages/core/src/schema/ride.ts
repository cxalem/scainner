import { Schema } from "effect";

export class Ride extends Schema.Class<Ride>("Ride")({
  id: Schema.Number,
  cloud_id: Schema.String,
  vehicle_id: Schema.Number,
  connection_id: Schema.Number,
  started_at: Schema.String,
  ended_at: Schema.NullOr(Schema.String),
  sample_count: Schema.Number,
  sensor_count: Schema.Number,
  dtc_events_count: Schema.Number,
  dtc_codes_appeared: Schema.Number,
  max_speed: Schema.NullOr(Schema.Number),
  max_coolant: Schema.NullOr(Schema.Number),
  min_voltage: Schema.NullOr(Schema.Number),
  notes: Schema.NullOr(Schema.String),
  constant_since_start: Schema.mutable(Schema.Array(Schema.String)),
}) {}

export const RideStatus = Schema.Struct({
  id: Schema.Number,
  started_at: Schema.String,
  sample_count: Schema.Number,
});
export type RideStatus = typeof RideStatus.Type;
