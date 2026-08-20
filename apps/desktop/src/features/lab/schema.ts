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
