import { Context, Effect, type ParseResult } from "effect";
import type { ApiError } from "../errors";
import type { CatalogItemKey, GenerateReportInput, Pricing, ReportRow } from "../schema/billing";

export class BillingService extends Context.Tag("BillingService")<
  BillingService,
  {
    readonly pricing: () => Effect.Effect<Pricing, ApiError | ParseResult.ParseError>;
    readonly createCheckout: (item: CatalogItemKey) => Effect.Effect<string, ApiError>;
    readonly generateReport: (input: GenerateReportInput) => Effect.Effect<{ report_id: string; status: string }, ApiError>;
    readonly getReport: (id: string) => Effect.Effect<ReportRow, ApiError | ParseResult.ParseError>;
    readonly listReports: () => Effect.Effect<ReportRow[], ApiError | ParseResult.ParseError>;
  }
>() {}
