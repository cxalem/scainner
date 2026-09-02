import { aggregateReadings, type Reading } from "../_shared/briefing.ts";
import { type AnthropicUsage, costUsd } from "../_shared/cost.ts";
import {
  adminClient,
  env,
  errorResponse,
  json,
  preflight,
  requireUser,
} from "../_shared/http.ts";
import { REPORT_SYSTEM_PROMPT } from "../_shared/prompt.ts";

type RequestBody = {
  kind?: "ride" | "code";
  ride_id?: string;
  scan_event_id?: string;
  dtc_code?: string;
  locale?: "en" | "es";
};

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: AnthropicUsage;
  error?: { message?: string };
};

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  let reportId: string | null = null;
  let userId: string | null = null;
  const db = adminClient();
  try {
    const user = await requireUser(request);
    userId = user.id;
    const body = await request.json() as RequestBody;
    if (!validBody(body)) return json({ error: "invalid_request" }, 400);
    const { data: report, error: insertError } = await db.from("reports")
      .insert({
        user_id: user.id,
        kind: body.kind,
        ride_id: body.kind === "ride" ? body.ride_id : null,
        scan_event_id: body.kind === "code" ? body.scan_event_id : null,
        dtc_code: body.kind === "code" ? body.dtc_code : null,
        locale: body.locale,
        status: "queued",
        model: "claude-opus-5",
      }).select("id").single();
    if (insertError) throw insertError;
    reportId = report.id;
    const currentReportId = report.id as string;
    const { data: source, error: creditError } = await db.rpc(
      "consume_report_credit",
      { p_user: user.id, p_report: currentReportId },
    );
    if (creditError) throw creditError;
    if (source === "none") {
      await db.from("reports").delete().eq("id", currentReportId);
      return json({ reason: "no_credit" }, 402);
    }
    const briefing = await buildBriefing(db, user.id, body);
    if (briefing.reason === "still_uploading") {
      await refundAndFail(
        db,
        user.id,
        currentReportId,
        "failed",
        "still_uploading",
      );
      return json({ reason: "still_uploading" }, 409);
    }
    await db.from("reports").update({ status: "running" }).eq(
      "id",
      currentReportId,
    );
    const anthropic = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env("ANTHROPIC_API_KEY"),
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: "claude-opus-5",
        max_tokens: 8000,
        output_config: { effort: "medium" },
        fallbacks: "default",
        system: [{
          type: "text",
          text: REPORT_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        }],
        messages: [{
          role: "user",
          content: JSON.stringify({ locale: body.locale, briefing }),
        }],
      }),
    });
    const payload = await anthropic.json() as AnthropicResponse;
    const usage = payload.usage ?? {};
    if (payload.stop_reason === "refusal") {
      await refundAndFail(
        db,
        user.id,
        currentReportId,
        "refused",
        "The model refused this report",
        usage,
      );
      return json({ report_id: currentReportId, status: "refused" });
    }
    if (!anthropic.ok) {
      throw new Error(
        payload.error?.message ?? `Anthropic returned ${anthropic.status}`,
      );
    }
    const content = payload.content?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "").join("\n").trim();
    if (!content) throw new Error("Anthropic returned no report text");
    const summary = summarize(content, briefing);
    const { error: updateError } = await db.from("reports").update({
      status: "done",
      content_md: content,
      summary,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
      cost_usd: costUsd(usage).toFixed(6),
      finished_at: new Date().toISOString(),
    }).eq("id", currentReportId);
    if (updateError) throw updateError;
    return json({ report_id: currentReportId, status: "done" });
  } catch (error) {
    if (reportId && userId) {
      await refundAndFail(
        db,
        userId,
        reportId,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    return errorResponse(error);
  }
});

function validBody(
  body: RequestBody,
): body is Required<Pick<RequestBody, "kind" | "locale">> & RequestBody {
  if (!body.locale || !["en", "es"].includes(body.locale)) return false;
  if (body.kind === "ride") {
    return Boolean(body.ride_id && !body.scan_event_id && !body.dtc_code);
  }
  if (body.kind === "code") {
    return Boolean(body.scan_event_id && body.dtc_code && !body.ride_id);
  }
  return false;
}

async function buildBriefing(
  db: ReturnType<typeof adminClient>,
  userId: string,
  body: RequestBody,
): Promise<Record<string, unknown>> {
  if (body.kind === "ride") {
    const { data: ride, error } = await db.from("rides").select(
      "*,vehicles!inner(vin,display_name,make,model,year),connections!inner(device_kind,elm_version,protocol)",
    ).eq("id", body.ride_id!).eq("user_id", userId).single();
    if (error) throw error;
    let query = db.from("readings").select("ts,key,value").eq(
      "connection_id",
      ride.connection_id,
    ).gte("ts", ride.started_at).lte("ts", ride.ended_at);
    if (ride.start_reading_id != null) {
      query = query.gt("local_id", ride.start_reading_id);
    }
    if (ride.end_reading_id != null) {
      query = query.lte("local_id", ride.end_reading_id);
    }
    const [
      { data: readings, error: readingsError },
      { data: events, error: eventsError },
      { data: modules, error: modulesError },
    ] = await Promise.all([
      query,
      db.from("dtc_scan_events").select(
        "ts,mil_on,voltage,freeze_frame,dtc_codes(code,status)",
      ).eq("vehicle_id", ride.vehicle_id).gte("ts", ride.started_at).lte(
        "ts",
        ride.ended_at,
      ),
      db.from("discovered_modules").select(
        "module_address,module_name,supplier,system_name,last_seen_at,discovered_dids(did,label,confidence,byte_length)",
      ).eq("vehicle_id", ride.vehicle_id),
    ]);
    if (readingsError || eventsError || modulesError) {
      throw readingsError ?? eventsError ?? modulesError;
    }
    if ((readings?.length ?? 0) < 0.95 * ride.sample_count) {
      return { reason: "still_uploading" };
    }
    const vehicle = ride.vehicles;
    return {
      kind: "ride",
      ride: without(ride, ["user_id", "vehicles", "vin"]),
      vehicle: {
        display_name: vehicle.display_name,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        wmi: vehicle.vin?.slice(0, 3) ?? null,
      },
      readings: aggregateReadings((readings ?? []) as Reading[]),
      events: events ?? [],
      module_probe_summaries: modules ?? [],
    };
  }
  const { data: scan, error } = await db.from("dtc_scan_events").select(
    "*,vehicles!inner(owner_user_id,vin,display_name,make,model,year),dtc_codes(code,status)",
  ).eq("id", body.scan_event_id!).eq("vehicles.owner_user_id", userId).single();
  if (error) throw error;
  if (
    !(scan.dtc_codes as Array<{ code: string }>).some((item) =>
      item.code === body.dtc_code
    )
  ) throw new Error("Code is not present in this scan");
  const start = new Date(new Date(scan.ts).getTime() - 600_000).toISOString();
  const [
    { data: readings, error: readingsError },
    { data: modules, error: modulesError },
  ] = await Promise.all([
    db.from("readings").select("ts,key,value").eq("vehicle_id", scan.vehicle_id)
      .gte("ts", start).lte("ts", scan.ts),
    db.from("discovered_modules").select(
      "module_address,module_name,supplier,system_name,last_seen_at,discovered_dids(did,label,confidence,byte_length)",
    ).eq("vehicle_id", scan.vehicle_id),
  ]);
  if (readingsError || modulesError) throw readingsError ?? modulesError;
  const vehicle = scan.vehicles;
  return {
    kind: "code",
    requested_code: body.dtc_code,
    scan: without(scan, ["vehicles", "vin"]),
    vehicle: {
      display_name: vehicle.display_name,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      wmi: vehicle.vin?.slice(0, 3) ?? null,
    },
    readings: aggregateReadings((readings ?? []) as Reading[]),
    module_probe_summaries: modules ?? [],
  };
}

function without(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
}

function summarize(content: string, briefing: Record<string, unknown>) {
  const verdict =
    content.match(/^# (?:Verdict|Veredicto)\s*\n+([^\n#]+)/mi)?.[1]?.trim() ??
      "";
  const readings = briefing.readings as {
    reading_count?: number;
    channel_count?: number;
  } | undefined;
  const events = briefing.events as unknown[] | undefined;
  return {
    verdict,
    readings: readings?.reading_count ?? 0,
    channels: readings?.channel_count ?? 0,
    events: events?.length ?? 0,
  };
}

async function refundAndFail(
  db: ReturnType<typeof adminClient>,
  userId: string,
  reportId: string,
  status: "failed" | "refused",
  error: string,
  usage: AnthropicUsage = {},
) {
  await db.rpc("refund_report_credit", { p_user: userId, p_report: reportId });
  await db.from("reports").update({
    status,
    error: error.slice(0, 1000),
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
    cost_usd: costUsd(usage).toFixed(6),
    finished_at: new Date().toISOString(),
  }).eq("id", reportId);
}
