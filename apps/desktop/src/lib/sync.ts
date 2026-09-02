import { invoke, MOCK_MODE } from "@/lib/tauri";
import { supabase } from "@/lib/supabase";

type SyncBatch = {
  vehicles: {
    cloud_id: string;
    vin: string | null;
    display_name: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    trim: string | null;
    fuel_price: number;
  }[];
  connections: {
    cloud_id: string;
    vehicle_cloud_id: string;
    device_kind: string | null;
    elm_version: string | null;
    protocol: string | null;
    started_at: string;
    ended_at: string | null;
  }[];
  scan_events: {
    cloud_id: string;
    connection_cloud_id: string | null;
    vehicle_cloud_id: string;
    ts: string;
    mil_on: boolean;
    voltage: number | null;
    freeze_json: string | null;
    codes: { code: string; status: string }[];
  }[];
  writes: {
    cloud_id: string;
    connection_cloud_id: string | null;
    vehicle_cloud_id: string;
    ts: string;
    module: string;
    action: string;
    params_json: string;
    before_json: string | null;
    after_json: string | null;
    outcome: string;
    error: string | null;
  }[];
  readings: {
    local_id: number;
    connection_cloud_id: string;
    vehicle_cloud_id: string;
    ts: string;
    key: string;
    value: number;
  }[];
  probes: {
    cloud_id: string; vehicle_cloud_id: string; module: string; did: number;
    label: string; unit: string; offset: number; len: number; scale: number;
    bias: number; enabled: boolean; origin: "manual" | "discovery";
  }[];
  discovered_modules: {
    cloud_id: string; vehicle_cloud_id: string; module_address: string;
    module_name: string | null; discovered_at: string;
    last_seen_at: string;
    spare_part_number: string | null; hardware_version: string | null;
    software_version: string | null; system_name: string | null;
    fingerprint_match_key: string | null; route_json: string | null;
    family_id: string | null; route_state: string | null; supplier: string | null;
    dids: { did: number; byte_length: number | null; label: string | null; confidence: string | null; first_seen_at: string }[];
  }[];
  knowledge_candidates: {
    id: number; cloud_id: string; compatibility_key: string;
    scope: "ecu_family" | "exact_ecu" | "observation"; family_id: string | null;
    module_address: string; supplier: string | null; spare_part_number: string | null;
    hardware_version: string | null; software_version: string | null; system_name: string | null;
    route_json: string | null; did: number; payload_length: number | null;
    knowledge_state: string; label: string | null; decode_json: string | null;
    shape_json: string | null; interpretations_json: string | null; confidence: number | null;
    discriminating_test: string | null; first_observed_at: string; last_observed_at: string;
  }[];
  diagnostic_cases: {
    cloud_id: string; vehicle_cloud_id: string; reference: string;
    status: "open" | "in_progress" | "waiting" | "completed" | "cancelled";
    complaint: string; odometer_km: number | null; assigned_to: string | null;
    opened_at: string; updated_at: string; closed_at: string | null;
  }[];
  last_reading_id: number;
};

export type SyncStatus = {
  phase: "signed_out" | "idle" | "syncing" | "error";
  lastSyncAt: number | null;
  lastError: string | null;
  pushedReadings: number;
};

const WATERMARK_KEY = "sync_last_reading_id";
const INTERVAL_MS = 30_000;
const BATCH_LIMIT = 5_000;

let status: SyncStatus = { phase: "signed_out", lastSyncAt: null, lastError: null, pushedReadings: 0 };
const listeners = new Set<() => void>();
let timer: number | null = null;
let running = false;

function setStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  listeners.forEach((l) => l());
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getSyncStatus(): SyncStatus {
  return status;
}

const toIso = (ts: string) => `${ts.replace(" ", "T")}Z`;

export function mapKnowledgeCandidate(
  candidate: SyncBatch["knowledge_candidates"][number],
  userId: string,
) {
  return {
    id: candidate.cloud_id,
    contributor_user_id: userId,
    compatibility_key: candidate.compatibility_key,
    scope: candidate.scope,
    family_id: candidate.family_id,
    module_address: candidate.module_address,
    supplier: candidate.supplier,
    spare_part_number: candidate.spare_part_number,
    hardware_version: candidate.hardware_version,
    software_version: candidate.software_version,
    system_name: candidate.system_name,
    route: candidate.route_json ? JSON.parse(candidate.route_json) : null,
    did: candidate.did,
    payload_length: candidate.payload_length,
    knowledge_state: candidate.knowledge_state,
    label: candidate.label,
    decode: candidate.decode_json ? JSON.parse(candidate.decode_json) : null,
    shape: candidate.shape_json ? JSON.parse(candidate.shape_json) : null,
    interpretations: candidate.interpretations_json ? JSON.parse(candidate.interpretations_json) : null,
    confidence: candidate.confidence,
    discriminating_test: candidate.discriminating_test,
    first_observed_at: toIso(candidate.first_observed_at),
    last_observed_at: toIso(candidate.last_observed_at),
  };
}

async function getWatermark(): Promise<number> {
  const raw = await invoke<string | null>("app_setting_get", { key: WATERMARK_KEY });
  const n = raw != null ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function resetSyncWatermark(): Promise<void> {
  await invoke<void>("app_setting_set", { key: WATERMARK_KEY, value: "0" });
}

async function runSyncOnce(): Promise<void> {
  if (running) return;
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    setStatus({ phase: "signed_out" });
    return;
  }
  if (!navigator.onLine) return;
  running = true;
  setStatus({ phase: "syncing", lastError: null });
  try {
    const watermark = await getWatermark();
    const batch = await invoke<SyncBatch>("sync_batch", { afterReadingId: watermark, limit: BATCH_LIMIT });
    const userId = session.user.id;

    const fail = (step: string, error: { message: string } | null) => {
      if (error) throw new Error(`${step}: ${error.message}`);
    };

    if (batch.vehicles.length > 0) {
      const { error } = await supabase.from("vehicles").upsert(
        batch.vehicles.map((v) => ({
          id: v.cloud_id,
          vin: v.vin,
          display_name: v.display_name,
          make: v.make,
          model: v.model,
          year: v.year,
          trim: v.trim,
          fuel_price: v.fuel_price,
          owner_user_id: userId,
        })),
        { onConflict: "id" },
      );
      fail("vehicles", error);
    }
    if (batch.connections.length > 0) {
      const { error } = await supabase.from("connections").upsert(
        batch.connections.map((c) => ({
          id: c.cloud_id,
          vehicle_id: c.vehicle_cloud_id,
          device_kind: c.device_kind,
          elm_version: c.elm_version,
          protocol: c.protocol,
          started_at: toIso(c.started_at),
          ended_at: c.ended_at ? toIso(c.ended_at) : null,
        })),
        { onConflict: "id" },
      );
      fail("connections", error);
    }
    if (batch.diagnostic_cases.length > 0) {
      const { error } = await supabase.from("diagnostic_cases").upsert(
        batch.diagnostic_cases.map((item) => ({
          client_uuid: item.cloud_id,
          vehicle_id: item.vehicle_cloud_id,
          reference: item.reference,
          status: item.status,
          complaint: item.complaint,
          odometer_km: item.odometer_km,
          assigned_to: item.assigned_to,
          opened_at: toIso(item.opened_at),
          updated_at: toIso(item.updated_at),
          closed_at: item.closed_at ? toIso(item.closed_at) : null,
        })),
        { onConflict: "client_uuid" },
      );
      fail("diagnostic_cases", error);
    }
    if (batch.scan_events.length > 0) {
      const { error } = await supabase.from("dtc_scan_events").upsert(
        batch.scan_events.map((e) => ({
          id: e.cloud_id,
          connection_id: e.connection_cloud_id,
          vehicle_id: e.vehicle_cloud_id,
          ts: toIso(e.ts),
          mil_on: e.mil_on,
          voltage: e.voltage,
          freeze_frame: e.freeze_json ? JSON.parse(e.freeze_json) : null,
        })),
        { onConflict: "id" },
      );
      fail("dtc_scan_events", error);
      const codes = batch.scan_events.flatMap((e) =>
        e.codes.map((c) => ({
          scan_event_id: e.cloud_id,
          vehicle_id: e.vehicle_cloud_id,
          code: c.code,
          status: c.status,
        })),
      );
      if (codes.length > 0) {
        const { error: codesError } = await supabase
          .from("dtc_codes")
          .upsert(codes, { onConflict: "scan_event_id,code,status", ignoreDuplicates: true });
        fail("dtc_codes", codesError);
      }
    }
    if (batch.writes.length > 0) {
      const { error } = await supabase.from("writes_log").upsert(
        batch.writes.map((w) => ({
          client_uuid: w.cloud_id,
          connection_id: w.connection_cloud_id,
          vehicle_id: w.vehicle_cloud_id,
          ts: toIso(w.ts),
          module: w.module,
          action: w.action,
          params: JSON.parse(w.params_json),
          before_state: w.before_json ? JSON.parse(w.before_json) : null,
          after_state: w.after_json ? JSON.parse(w.after_json) : null,
          outcome: w.outcome,
          error: w.error,
        })),
        { onConflict: "client_uuid", ignoreDuplicates: true },
      );
      fail("writes_log", error);
    }
    if (batch.readings.length > 0) {
      const { error } = await supabase.from("readings").upsert(
        batch.readings.map((r) => ({
          connection_id: r.connection_cloud_id,
          vehicle_id: r.vehicle_cloud_id,
          local_id: r.local_id,
          ts: toIso(r.ts),
          key: r.key,
          value: r.value,
        })),
        { onConflict: "connection_id,local_id", ignoreDuplicates: true },
      );
      fail("readings", error);
    }
    if (batch.probes.length > 0) {
      const { error } = await supabase.from("uds_probes").upsert(
        batch.probes.map((p) => ({
          client_uuid: p.cloud_id, vehicle_id: p.vehicle_cloud_id, module: p.module,
          did: p.did, label: p.label, unit: p.unit, byte_offset: p.offset, len: p.len,
          scale: p.scale, bias: p.bias, enabled: p.enabled, origin: p.origin,
        })),
        { onConflict: "client_uuid" },
      );
      fail("uds_probes", error);
    }
    if (batch.discovered_modules.length > 0) {
      const { error } = await supabase.from("discovered_modules").upsert(
        batch.discovered_modules.map((m) => ({
          id: m.cloud_id, vehicle_id: m.vehicle_cloud_id, module_address: m.module_address,
          module_name: m.module_name, discovered_at: toIso(m.discovered_at),
          last_seen_at: toIso(m.last_seen_at),
          spare_part_number: m.spare_part_number, hardware_version: m.hardware_version,
          software_version: m.software_version, system_name: m.system_name,
          fingerprint_match_key: m.fingerprint_match_key,
          route: m.route_json ? JSON.parse(m.route_json) : null,
          family_id: m.family_id, route_state: m.route_state, supplier: m.supplier,
        })),
        { onConflict: "id" },
      );
      fail("discovered_modules", error);
      const dids = batch.discovered_modules.flatMap((m) => m.dids.map((d) => ({
        module_id: m.cloud_id, did: d.did,
        byte_length: d.byte_length, label: d.label, confidence: d.confidence,
        first_seen_at: toIso(d.first_seen_at),
      })));
      if (dids.length > 0) {
        const { error: didError } = await supabase
          .from("discovered_dids")
          .upsert(dids, { onConflict: "module_id,did" });
        fail("discovered_dids", didError);
      }
    }
    if (batch.knowledge_candidates.length > 0) {
      const { error } = await supabase.from("knowledge_candidates").upsert(
        batch.knowledge_candidates.map((candidate) => mapKnowledgeCandidate(candidate, userId)),
        { onConflict: "contributor_user_id,compatibility_key,did" },
      );
      fail("knowledge_candidates", error);
    }
    await invoke<void>("app_setting_set", { key: WATERMARK_KEY, value: String(batch.last_reading_id) });
    setStatus({
      phase: "idle",
      lastSyncAt: Date.now(),
      pushedReadings: status.pushedReadings + batch.readings.length,
    });
  } catch (e) {
    setStatus({ phase: "error", lastError: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
  }
}

export function requestSync(): void {
  void runSyncOnce();
}

export function startSyncLoop(): void {
  if (MOCK_MODE || timer != null) return;
  timer = window.setInterval(() => void runSyncOnce(), INTERVAL_MS);
  void runSyncOnce();
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) void runSyncOnce();
    else setStatus({ phase: "signed_out" });
  });
}
