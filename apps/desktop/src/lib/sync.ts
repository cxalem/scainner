// The cloud sync engine: pushes the local SQLite record up to Supabase
// under the signed-in user's JWT, in idempotent batches.
//
// Design (docs/workflows/data-core/plan.md, sync section):
// - Local SQLite stays the source of record; the app works fully offline
//   forever. This loop only runs when a user is signed in AND online —
//   sign-in enables sync, it never gates the app.
// - Leak-free by construction: every request goes through supabase-js with
//   the user's JWT; Postgres RLS decides row by row. There is no write
//   path that bypasses it.
// - Idempotent by construction: vehicles/connections/scan_events carry
//   client-generated uuids as their cloud PRIMARY KEYS; readings conflict
//   on (connection_id, local_id); dtc_codes on (event, code, status);
//   writes_log on client_uuid. A retried batch upserts into a no-op.
// - Low-volume tables (vehicles/connections/events/writes) re-push wholly
//   every cycle (tens of rows, and it doubles as repair); readings are
//   incremental behind a watermark persisted in app_settings.
// - Unidentified rows (no vehicle) are EXCLUDED by the Rust feed — the
//   cloud's RLS rejects them by design. Naming a car back-stamps them,
//   and resetSyncWatermark() makes the next cycle re-scan from zero so
//   the newly claimed readings ship too.
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
  last_reading_id: number;
};

export type SyncStatus = {
  phase: "signed_out" | "idle" | "syncing" | "error";
  lastSyncAt: number | null;
  lastError: string | null;
  /** Total readings pushed this app session. */
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

// useSyncExternalStore-compatible pair for the Account card.
export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getSyncStatus(): SyncStatus {
  return status;
}

/** SQLite's `datetime('now')` is UTC without a timezone marker; Postgres
 * must not re-interpret it in some other zone. */
const toIso = (ts: string) => `${ts.replace(" ", "T")}Z`;

async function getWatermark(): Promise<number> {
  const raw = await invoke<string | null>("app_setting_get", { key: WATERMARK_KEY });
  const n = raw != null ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Called after naming a VIN-less car: its already-recorded readings just
 * got back-stamped with the new vehicle, and they live BEHIND the current
 * watermark — rescan from zero (idempotent, so re-pushing is a no-op for
 * everything already uploaded). */
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
  if (!navigator.onLine) return; // quiet skip — offline is a normal state
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

/** Kick a sync now (the Account card's button, and post-sign-in). */
export function requestSync(): void {
  void runSyncOnce();
}

/** Idempotent — App.tsx calls this once on mount. No-op in the browser
 * preview (no Tauri backend to pull batches from). */
export function startSyncLoop(): void {
  if (MOCK_MODE || timer != null) return;
  timer = window.setInterval(() => void runSyncOnce(), INTERVAL_MS);
  void runSyncOnce();
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) void runSyncOnce();
    else setStatus({ phase: "signed_out" });
  });
}
