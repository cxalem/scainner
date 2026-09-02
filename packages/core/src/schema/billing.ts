import { Schema } from "effect";

export const CatalogItemKey = Schema.Literal("single", "pack_5", "pack_20", "subscription_monthly");
export type CatalogItemKey = typeof CatalogItemKey.Type;

export class PriceItem extends Schema.Class<PriceItem>("PriceItem")({
  price_id: Schema.String,
  currency: Schema.String,
  unit_amount: Schema.NullOr(Schema.Number),
}) {}

export class SubscriptionState extends Schema.Class<SubscriptionState>("SubscriptionState")({
  status: Schema.String,
  plan: Schema.String,
  monthly_allowance: Schema.Number,
  allowance_used: Schema.Number,
  current_period_end: Schema.NullOr(Schema.String),
}) {}

export class Pricing extends Schema.Class<Pricing>("Pricing")({
  catalog: Schema.Struct({
    single: PriceItem,
    pack_5: PriceItem,
    pack_20: PriceItem,
    subscription_monthly: PriceItem,
  }),
  account: Schema.NullOr(Schema.Struct({
    balance: Schema.Number,
    subscription: Schema.NullOr(SubscriptionState),
  })),
}) {}

export const ReportKind = Schema.Literal("ride", "code");
export const ReportLocale = Schema.Literal("en", "es");
export const ReportStatus = Schema.Literal("queued", "running", "done", "failed", "refused");

export class ReportSummary extends Schema.Class<ReportSummary>("ReportSummary")({
  verdict: Schema.optionalWith(Schema.String, { default: () => "" }),
  readings: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  channels: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  events: Schema.optionalWith(Schema.Number, { default: () => 0 }),
}) {}

export class ReportRow extends Schema.Class<ReportRow>("ReportRow")({
  id: Schema.String,
  user_id: Schema.String,
  kind: ReportKind,
  ride_id: Schema.NullOr(Schema.String),
  scan_event_id: Schema.NullOr(Schema.String),
  dtc_code: Schema.NullOr(Schema.String),
  locale: ReportLocale,
  status: ReportStatus,
  model: Schema.String,
  content_md: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(ReportSummary),
  error: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  finished_at: Schema.NullOr(Schema.String),
}) {}

export type GenerateReportInput =
  | { kind: "ride"; ride_id: string; locale: "en" | "es" }
  | { kind: "code"; scan_event_id?: string; dtc_code: string; locale: "en" | "es" };
