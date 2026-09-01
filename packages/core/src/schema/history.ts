// Response type for History.tsx's per-sensor time series.
import { Schema } from "effect";

export class HistoryPoint extends Schema.Class<HistoryPoint>("HistoryPoint")({
  ts: Schema.String,
  value: Schema.Number,
}) {}

/// One stored reading key with what the Over-time browser needs to name,
/// group and sort it. `label`/`unit` are null for standard OBD keys — the
/// desktop app names those from its gauge table; `module_name` is null only
/// when nothing local can resolve the module.
export class ReadingKey extends Schema.Class<ReadingKey>("ReadingKey")({
  key: Schema.String,
  label: Schema.NullOr(Schema.String),
  unit: Schema.NullOr(Schema.String),
  module_key: Schema.NullOr(Schema.String),
  module_name: Schema.NullOr(Schema.String),
  source: Schema.Literal("standard", "probe"),
  probe_id: Schema.NullOr(Schema.Number),
  /// Newest reading timestamp for the key ("YYYY-MM-DD HH:MM:SS", UTC).
  last_ts: Schema.NullOr(Schema.String),
}) {}
