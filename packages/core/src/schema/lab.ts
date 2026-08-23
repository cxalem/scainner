// Response types for the UDS/Lab surface (Lab.tsx and its cards:
// DidReader, RangeScanner, ModuleFaults, ModuleManager, ProbeManager).
import { Schema } from "effect";

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
// Verified per-module UDS clear (before/after fault code lists).
export class ClearOutcome extends Schema.Class<ClearOutcome>("ClearOutcome")({
  before: Schema.mutable(Schema.Array(Schema.String)),
  accepted: Schema.Boolean,
  after: Schema.mutable(Schema.Array(Schema.String)),
}) {}

/// Result of one auto-discovery pass (uds::DiscoveryReport). `cancelled`
/// means the user stopped it — whatever was found is still persisted.
export class DiscoveryReport extends Schema.Class<DiscoveryReport>("DiscoveryReport")({
  modules_found: Schema.Number,
  dids_found: Schema.Number,
  cancelled: Schema.Boolean,
}) {}

/// One module a discovery pass found on this vehicle, with how many DIDs
/// it holds and how many of those the knowledge map could already name.
export class DiscoveredModule extends Schema.Class<DiscoveredModule>("DiscoveredModule")({
  id: Schema.Number,
  address: Schema.String,
  name: Schema.NullOr(Schema.String),
  discovered_at: Schema.String,
  did_count: Schema.Number,
  labeled_count: Schema.Number,
}) {}

export class DiscoveredDid extends Schema.Class<DiscoveredDid>("DiscoveredDid")({
  did: Schema.Number,
  raw_sample: Schema.NullOr(Schema.String),
  byte_length: Schema.NullOr(Schema.Number),
  label: Schema.NullOr(Schema.String),
  confidence: Schema.NullOr(Schema.String),
}) {}
