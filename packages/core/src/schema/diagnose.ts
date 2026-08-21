// Response types for the DTC/diagnose surface (Diagnose.tsx, its detail
// modal, WriteHistory.tsx's audit trail).
import { Schema } from "effect";

const dtcResultFields = {
  mil_on: Schema.Boolean,
  dtc_count: Schema.Number,
  // Schema.mutable: Diagnose.tsx pushes/spreads these into its own useState
  // arrays — a plain `string[]`, like the type this replaces, not
  // Schema.Array's default `readonly string[]`.
  stored: Schema.mutable(Schema.Array(Schema.String)),
  pending: Schema.mutable(Schema.Array(Schema.String)),
  permanent: Schema.mutable(Schema.Array(Schema.String)),
  voltage: Schema.optional(Schema.NullOr(Schema.Number)),
  freeze: Schema.optional(Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.Unknown }))),
};
export class DtcResult extends Schema.Class<DtcResult>("DtcResult")(dtcResultFields) {}
export class DtcScanRow extends Schema.Class<DtcScanRow>("DtcScanRow")({
  ...dtcResultFields,
  // Override: db::DtcScan (a historical row, src-tauri/src/db.rs) never
  // had a dtc_count field — only the live obd::DtcResult struct does
  // (src-tauri/src/elm/obd.rs). Spreading dtcResultFields as-is required
  // it on every historical row too, so EVERY row failed to decode and
  // dtcHistory()'s whole array decode failed with it — "Could not load
  // scan history," always, for any real data. Went unnoticed because
  // nothing had exercised this with actual historical scans present
  // until real testing finally produced enough of them (2026-08-21) to
  // hit the array-decode path at all. Diagnose.tsx never reads
  // scan.dtc_count for a history row anyway (it derives a fresh count
  // from stored/pending/permanent locally) — nothing downstream needed
  // fixing beyond this schema.
  dtc_count: Schema.optional(Schema.Number),
  id: Schema.Number,
  ts: Schema.String,
}) {}
// Verified engine clear: the scan right before the clear and right after.
export class ObdClearOutcome extends Schema.Class<ObdClearOutcome>("ObdClearOutcome")({
  before: DtcResult,
  after: DtcResult,
}) {}
// One row of the write audit trail (writes_log table) — covers writes from
// both this feature (clear_dtcs) and lab (uds_clear); it lives here because
// WriteHistory.tsx (its only consumer) renders inside Diagnose.
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
