// Response type for History.tsx's per-sensor time series.
import { Schema } from "effect";

export class HistoryPoint extends Schema.Class<HistoryPoint>("HistoryPoint")({
  ts: Schema.String,
  value: Schema.Number,
}) {}
