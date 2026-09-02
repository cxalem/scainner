import { Schema } from "effect";
import { DiagnosticOutcome } from "./diagnostic-outcome";

const dtcResultFields = {
  mil_on: Schema.Boolean,
  dtc_count: Schema.Number,
  stored: Schema.mutable(Schema.Array(Schema.String)),
  pending: Schema.mutable(Schema.Array(Schema.String)),
  permanent: Schema.mutable(Schema.Array(Schema.String)),
  voltage: Schema.optional(Schema.NullOr(Schema.Number)),
  freeze: Schema.optional(Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.Unknown }))),
};
export class DtcResult extends Schema.Class<DtcResult>("DtcResult")(dtcResultFields) {}
export class DtcScanRow extends Schema.Class<DtcScanRow>("DtcScanRow")({
  ...dtcResultFields,
  dtc_count: Schema.optional(Schema.Number),
  id: Schema.Number,
  ts: Schema.String,
}) {}
export class ObdClearOutcome extends Schema.Class<ObdClearOutcome>("ObdClearOutcome")({
  before: DtcResult,
  after: DtcResult,
  outcome: DiagnosticOutcome,
}) {}
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
