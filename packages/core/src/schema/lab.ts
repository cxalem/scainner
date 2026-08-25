// Response types for the UDS/Lab surface (Lab.tsx and its cards:
// DidReader, RangeScanner, ModuleFaults, ModuleManager, ProbeManager).
import { Schema } from "effect";
import { DiagnosticOutcome } from "./diagnostic-outcome";

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
  // null only for legacy (pre-scoping) global probes — every probe saved
  // from now on, manual or auto-discovered, carries a real vehicle_id.
  vehicle_id: Schema.optional(Schema.NullOr(Schema.Number)),
  module: Schema.String,
  did: Schema.Number,
  label: Schema.String,
  unit: Schema.String,
  offset: Schema.Number,
  len: Schema.Number,
  scale: Schema.Number,
  bias: Schema.Number,
  enabled: Schema.Boolean,
  // Older clients may omit this when creating a manual probe; the Rust
  // boundary defaults it to `manual`. Rows read back from SQLite always
  // carry either `manual` or `discovery`.
  origin: Schema.optional(Schema.Literal("manual", "discovery")),
}) {}
// Verified per-module UDS clear (before/after fault code lists).
export class ClearOutcome extends Schema.Class<ClearOutcome>("ClearOutcome")({
  before: Schema.mutable(Schema.Array(Schema.String)),
  accepted: Schema.Boolean,
  refusal_reason: Schema.NullOr(Schema.String),
  after: Schema.mutable(Schema.Array(Schema.String)),
  outcome: DiagnosticOutcome,
}) {}

/// Result of one auto-discovery pass (uds::DiscoveryReport). `cancelled`
/// means the scan didn't finish — whatever was found is still persisted
/// either way. `auto_stopped_reason` distinguishes a user cancel from the
/// scan stopping ITSELF because it detected the engine starting mid-scan
/// (a real risk: a module held in an extended session while the engine
/// starts can throw dash warnings/comm faults on it).
export class ModuleProbeResult extends Schema.Class<ModuleProbeResult>("ModuleProbeResult")({
  request_address: Schema.String,
  response_address: Schema.String,
  expected_name: Schema.NullOr(Schema.String),
  profile_candidate: Schema.Boolean,
  source: Schema.Literal("profile", "conventional_11bit", "normal_fixed_29bit"),
  outcome: DiagnosticOutcome,
}) {}

export class EcuIdentityEvidence extends Schema.Class<EcuIdentityEvidence>("EcuIdentityEvidence")({
  did: Schema.Number,
  label: Schema.String,
  outcome: DiagnosticOutcome,
  raw_value: Schema.NullOr(Schema.String),
  decoded_value: Schema.NullOr(Schema.String),
}) {}

export class EcuFingerprint extends Schema.Class<EcuFingerprint>("EcuFingerprint")({
  request_address: Schema.String,
  response_address: Schema.String,
  spare_part_number: Schema.NullOr(Schema.String),
  hardware_version: Schema.NullOr(Schema.String),
  software_version: Schema.NullOr(Schema.String),
  system_name: Schema.NullOr(Schema.String),
  match_key: Schema.NullOr(Schema.String),
  fields_answered: Schema.Number,
  fields_total: Schema.Number,
  evidence: Schema.mutable(Schema.Array(EcuIdentityEvidence)),
}) {}

export class DiscoveryCoverage extends Schema.Class<DiscoveryCoverage>("DiscoveryCoverage")({
  candidates_total: Schema.Number,
  candidates_attempted: Schema.Number,
  candidates_skipped: Schema.Number,
  profile_candidates: Schema.Number,
  profile_reached: Schema.Number,
  reached: Schema.Number,
  refused: Schema.Number,
  timed_out: Schema.Number,
  transport_failed: Schema.Number,
  malformed: Schema.Number,
}) {}

export class DiscoveryReport extends Schema.Class<DiscoveryReport>("DiscoveryReport")({
  outcome: DiagnosticOutcome,
  coverage: DiscoveryCoverage,
  module_probes: Schema.mutable(Schema.Array(ModuleProbeResult)),
  fingerprints: Schema.mutable(Schema.Array(EcuFingerprint)),
  modules_found: Schema.Number,
  dids_found: Schema.Number,
  // Of dids_found, how many got a FULL decode formula from the knowledge
  // map and were promoted straight into the live poll loop — no "save as
  // probe" step, no re-scanning to see them again.
  sensors_added: Schema.Number,
  cancelled: Schema.Boolean,
  auto_stopped_reason: Schema.optional(Schema.NullOr(Schema.String)),
  // True when this pass only re-probed what a PRIOR pass on this car
  // already found, instead of the full blind sweep — much faster.
  was_fast_refresh: Schema.optional(Schema.Boolean),
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
  spare_part_number: Schema.NullOr(Schema.String),
  hardware_version: Schema.NullOr(Schema.String),
  software_version: Schema.NullOr(Schema.String),
  system_name: Schema.NullOr(Schema.String),
  fingerprint_match_key: Schema.NullOr(Schema.String),
  fingerprint_fields_answered: Schema.Number,
  fingerprint_fields_total: Schema.Number,
}) {}

export class DiscoveredDid extends Schema.Class<DiscoveredDid>("DiscoveredDid")({
  did: Schema.Number,
  raw_sample: Schema.NullOr(Schema.String),
  byte_length: Schema.NullOr(Schema.Number),
  label: Schema.NullOr(Schema.String),
  confidence: Schema.NullOr(Schema.String),
}) {}

export class FingerprintObservation extends Schema.Class<FingerprintObservation>("FingerprintObservation")({
  vehicle_ref: Schema.String,
  module_address: Schema.String,
  spare_part_number: Schema.NullOr(Schema.String),
  hardware_version: Schema.NullOr(Schema.String),
  software_version: Schema.NullOr(Schema.String),
  system_name: Schema.NullOr(Schema.String),
  fields_answered: Schema.Number,
}) {}

export class FingerprintMatchGroup extends Schema.Class<FingerprintMatchGroup>("FingerprintMatchGroup")({
  family_key: Schema.String,
  part_number: Schema.String,
  vehicle_count: Schema.Number,
  module_count: Schema.Number,
  hardware_versions: Schema.mutable(Schema.Array(Schema.String)),
  software_versions: Schema.mutable(Schema.Array(Schema.String)),
  system_names: Schema.mutable(Schema.Array(Schema.String)),
}) {}

export class FingerprintExperimentReport extends Schema.Class<FingerprintExperimentReport>("FingerprintExperimentReport")({
  target_vehicles: Schema.Number,
  vehicles_scanned: Schema.Number,
  vehicles_with_fingerprints: Schema.Number,
  modules_observed: Schema.Number,
  modules_with_fingerprints: Schema.Number,
  modules_with_part_number: Schema.Number,
  repeated_family_groups: Schema.Number,
  vehicles_with_repeated_family: Schema.Number,
  cohort_target_reached: Schema.Boolean,
  match_groups: Schema.mutable(Schema.Array(FingerprintMatchGroup)),
  observations: Schema.mutable(Schema.Array(FingerprintObservation)),
}) {}
