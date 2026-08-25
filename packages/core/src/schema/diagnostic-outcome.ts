import { Schema } from "effect";

export const DiagnosticStatus = Schema.Literal(
  "answered",
  "unsupported",
  "refused",
  "timed_out",
  "transport_failed",
  "cancelled",
  "skipped_for_safety",
  "malformed",
);
export type DiagnosticStatus = typeof DiagnosticStatus.Type;

export class DiagnosticOutcome extends Schema.Class<DiagnosticOutcome>("DiagnosticOutcome")({
  status: DiagnosticStatus,
  service: Schema.NullOr(Schema.String),
  nrc: Schema.NullOr(Schema.Number),
  detail: Schema.NullOr(Schema.String),
}) {}
