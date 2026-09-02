import { Schema } from "effect";

export const DeviceKind = Schema.Literal("bluetooth_serial", "usb_serial", "paired_only");
export type DeviceKind = typeof DeviceKind.Type;

export class AdapterCandidate extends Schema.Class<AdapterCandidate>("AdapterCandidate")({
  kind: Schema.String,
  id: Schema.String,
  name: Schema.String,
  likely_obd: Schema.Boolean,
  connected: Schema.NullOr(Schema.Boolean),
  display_name: Schema.optional(Schema.String),
  device_kind: Schema.optional(DeviceKind),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  bt_addr: Schema.optional(Schema.NullOr(Schema.String)),
  last_used: Schema.optional(Schema.Boolean),
}) {}

export class NearbyDevice extends Schema.Class<NearbyDevice>("NearbyDevice")({
  addr: Schema.String,
  name: Schema.NullOr(Schema.String),
  paired: Schema.Boolean,
}) {}

export const PIN_REQUIRED = "pin_required";

export class AdapterProfile extends Schema.Class<AdapterProfile>("AdapterProfile")({
  kind: Schema.Literal("elm_serial", "tcp_elm"),
  path: Schema.NullOr(Schema.String),
  bt_addr: Schema.NullOr(Schema.String),
  pin: Schema.String,
  host: Schema.NullOr(Schema.String),
  port: Schema.Number,
  baud: Schema.Number,
  timing: Schema.Literal("fast", "default", "slow"),
}) {}
