import { Effect, Layer, Schema, type ParseResult } from "effect";
import { ApiError, BillingService, Pricing, ReportRow, type CatalogItemKey, type GenerateReportInput } from "@scainner/core";
import { MOCK_MODE } from "@/lib/tauri";
import { supabase } from "@/lib/supabase";

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown): Effect.Effect<A, ApiError | ParseResult.ParseError> =>
  Schema.decodeUnknown(schema)(value);

const attempt = <A>(name: string, run: () => Promise<A>) => Effect.tryPromise({
  try: run,
  catch: (cause) => new ApiError({ detail: `${name}: ${cause instanceof Error ? cause.message : String(cause)}` }),
});

async function functionData<T>(name: string, body?: Record<string, unknown>, method?: "GET"): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, method ? { method } : { body });
  if (error) throw error;
  if (data == null) throw new Error(`${name} returned no data`);
  return data;
}

async function resolveScanEventId(input: Extract<GenerateReportInput, { kind: "code" }>): Promise<string> {
  if (input.scan_event_id) return input.scan_event_id;
  const { data, error } = await supabase
    .from("dtc_codes")
    .select("scan_event_id,dtc_scan_events!inner(ts)")
    .eq("code", input.dtc_code)
    .order("ts", { referencedTable: "dtc_scan_events", ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.scan_event_id) throw new Error("Sync this scan before generating its report");
  return data.scan_event_id;
}

export const BillingServiceLive = Layer.succeed(BillingService, {
  pricing: () => {
    const value = MOCK_MODE
      ? attempt("pricing", async () => (await import("@/lib/mock")).mockBilling.pricing())
      : attempt("pricing", () => functionData("pricing", undefined, "GET"));
    return value.pipe(Effect.flatMap((data) => decode(Pricing, data)));
  },
  createCheckout: (item: CatalogItemKey) => attempt("create checkout", async () => {
    if (MOCK_MODE) return (await import("@/lib/mock")).mockBilling.createCheckout(item);
    const data = await functionData<{ url: string }>("create-checkout", { item });
    return data.url;
  }),
  generateReport: (input) => attempt("generate report", async () => {
    if (MOCK_MODE) return (await import("@/lib/mock")).mockBilling.generateReport(input);
    const payload = input.kind === "code" ? { ...input, scan_event_id: await resolveScanEventId(input) } : input;
    return functionData<{ report_id: string; status: string }>("generate-report", payload);
  }),
  getReport: (id) => {
    const value = MOCK_MODE
      ? attempt("get report", async () => (await import("@/lib/mock")).mockBilling.getReport(id))
      : attempt("get report", async () => {
          const { data, error } = await supabase.from("reports").select("*").eq("id", id).single();
          if (error) throw error;
          return data;
        });
    return value.pipe(Effect.flatMap((data) => decode(ReportRow, data)));
  },
  listReports: () => {
    const value = MOCK_MODE
      ? attempt("list reports", async () => (await import("@/lib/mock")).mockBilling.listReports())
      : attempt("list reports", async () => {
          const { data, error } = await supabase.from("reports").select("*").order("created_at", { ascending: false });
          if (error) throw error;
          return data;
        });
    return value.pipe(Effect.flatMap((data) => decode(Schema.mutable(Schema.Array(ReportRow)), data)));
  },
});
