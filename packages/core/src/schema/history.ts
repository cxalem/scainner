import { Schema } from "effect";

export class HistoryPoint extends Schema.Class<HistoryPoint>("HistoryPoint")({
  ts: Schema.String,
  value: Schema.Number,
}) {}

export class ReadingKey extends Schema.Class<ReadingKey>("ReadingKey")({
  key: Schema.String,
  label: Schema.NullOr(Schema.String),
  unit: Schema.NullOr(Schema.String),
  module_key: Schema.NullOr(Schema.String),
  module_name: Schema.NullOr(Schema.String),
  source: Schema.Literal("standard", "probe"),
  probe_id: Schema.NullOr(Schema.Number),
  last_ts: Schema.NullOr(Schema.String),
}) {}
