import { Schema } from "effect";

export class AdapterCandidate extends Schema.Class<AdapterCandidate>("AdapterCandidate")({
  kind: Schema.String,
  id: Schema.String,
  name: Schema.String,
  likely_obd: Schema.Boolean,
  connected: Schema.NullOr(Schema.Boolean),
}) {}

export class AdapterProfile extends Schema.Class<AdapterProfile>("AdapterProfile")({
  kind: Schema.Literal("elm_serial", "tcp_elm"),
  path: Schema.NullOr(Schema.String),
  bt_addr: Schema.NullOr(Schema.String),
  pin: Schema.String,
  allow_repair: Schema.Boolean,
  host: Schema.NullOr(Schema.String),
  port: Schema.Number,
  baud: Schema.Number,
  timing: Schema.Literal("fast", "default", "slow"),
}) {}
