import { Schema } from "effect";

// What a row actually is, so the UI can write the secondary line in its
// own language instead of parsing a sentence the backend built.
export const DeviceKind = Schema.Literal("bluetooth_serial", "usb_serial", "paired_only");
export type DeviceKind = typeof DeviceKind.Type;

export class AdapterCandidate extends Schema.Class<AdapterCandidate>("AdapterCandidate")({
  kind: Schema.String,
  id: Schema.String,
  name: Schema.String,
  likely_obd: Schema.Boolean,
  connected: Schema.NullOr(Schema.Boolean),
  // Added with the device screen (2026-09-01). Optional so a payload from
  // an older backend still decodes; the UI falls back to `name`/`kind`.
  // The backend matches a serial node to the paired device behind it, so
  // display_name is the friendly name the vendor set and bt_addr is the
  // radio to bring up before opening `path` — neither is re-derived here.
  display_name: Schema.optional(Schema.String),
  device_kind: Schema.optional(DeviceKind),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  bt_addr: Schema.optional(Schema.NullOr(Schema.String)),
  last_used: Schema.optional(Schema.Boolean),
}) {}

/// A radio a scan found that is not paired yet — a dongle straight out of
/// the box. `name` is absent when it answered the inquiry without one, and
/// the UI shows the address instead of inventing a label. `paired` is what
/// the platform reported at scan time; the backend already drops anything
/// it knows to be paired, so a true here is only ever informational.
export class NearbyDevice extends Schema.Class<NearbyDevice>("NearbyDevice")({
  addr: Schema.String,
  name: Schema.NullOr(Schema.String),
  paired: Schema.Boolean,
}) {}

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
