// Read-only queries against the cloud schema
// (supabase/migrations/20260821000000_schema_v2.sql). RLS scopes every row
// to the signed-in user's JWT, so none of these filters by user — the
// database does that. All queries are bounded: the readings table is
// unbounded append-only telemetry, so stats are computed client-side from a
// capped window instead of asking Postgres to aggregate it (no RPC yet).
import { demoScans, demoStats, DEMO_VEHICLES, isDemo } from "./demo";
import { supabase } from "../lib/supabase";

// ---------- vehicles list ----------

export type VehicleListItem = {
  id: string;
  vin: string | null;
  displayName: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  connectionCount: number;
};

export async function fetchVehicles(): Promise<VehicleListItem[]> {
  if (isDemo()) return DEMO_VEHICLES;
  // connections(count) is a PostgREST aggregate embed — one query returns
  // each vehicle with its recorded-session count, no N+1.
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, vin, display_name, make, model, year, created_at, connections(count)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    vin: (row.vin as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    make: (row.make as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    year: (row.year as number | null) ?? null,
    connectionCount: (row.connections as { count: number }[] | null)?.[0]?.count ?? 0,
  }));
}

// ---------- vehicle detail: reading stats ----------

// The sensor keys shown as "key stats" — these are the desktop recorder's
// canonical reading keys (apps/desktop/src-tauri/src/elm/parser.rs PID
// table plus the ATRV "voltage" reading from supervisor.rs).
export const STAT_KEYS = ["coolant", "voltage", "rpm", "speed"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export type SensorStats = {
  key: StatKey;
  latest: number;
  latestTs: string;
  min: number;
  avg: number;
  max: number;
  samples: number;
};

const READINGS_WINDOW_DAYS = 7;
// Bounded on purpose: a 7-day window on a daily-driven car can hold far
// more voltage/rpm rows than a phone needs for min/avg/max. Newest-first
// with a cap means stats cover "the most recent N readings within 7 days"
// on very chatty vehicles — acceptable for a v1 glance screen.
const READINGS_ROW_CAP = 4000;

export async function fetchSensorStats(vehicleId: string): Promise<SensorStats[]> {
  if (isDemo()) return demoStats(vehicleId);
  const since = new Date(Date.now() - READINGS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("readings")
    .select("key, value, ts")
    .eq("vehicle_id", vehicleId)
    .gte("ts", since)
    .in("key", [...STAT_KEYS])
    .order("ts", { ascending: false })
    .limit(READINGS_ROW_CAP);
  if (error) throw new Error(error.message);

  const byKey = new Map<StatKey, { latest: number; latestTs: string; min: number; max: number; sum: number; n: number }>();
  for (const row of data ?? []) {
    const key = row.key as StatKey;
    const value = row.value as number;
    const ts = row.ts as string;
    const acc = byKey.get(key);
    if (acc == null) {
      // Rows arrive newest-first, so the first row per key is its latest.
      byKey.set(key, { latest: value, latestTs: ts, min: value, max: value, sum: value, n: 1 });
    } else {
      acc.min = Math.min(acc.min, value);
      acc.max = Math.max(acc.max, value);
      acc.sum += value;
      acc.n += 1;
    }
  }

  // Stable display order: the STAT_KEYS order, keys with no data omitted.
  return STAT_KEYS.flatMap((key) => {
    const acc = byKey.get(key);
    if (acc == null) return [];
    return [{ key, latest: acc.latest, latestTs: acc.latestTs, min: acc.min, avg: acc.sum / acc.n, max: acc.max, samples: acc.n }];
  });
}

// ---------- vehicle detail: scan history ----------

export type DtcStatus = "stored" | "pending" | "permanent";

export type ScanEvent = {
  id: string;
  ts: string;
  milOn: boolean;
  voltage: number | null;
  codes: { code: string; status: DtcStatus }[];
};

const SCAN_EVENTS_CAP = 25;

export async function fetchScanHistory(vehicleId: string): Promise<ScanEvent[]> {
  if (isDemo()) return demoScans(vehicleId);
  const { data, error } = await supabase
    .from("dtc_scan_events")
    .select("id, ts, mil_on, voltage, dtc_codes(code, status)")
    .eq("vehicle_id", vehicleId)
    .order("ts", { ascending: false })
    .limit(SCAN_EVENTS_CAP);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    ts: row.ts as string,
    milOn: row.mil_on as boolean,
    voltage: (row.voltage as number | null) ?? null,
    codes: ((row.dtc_codes as { code: string; status: DtcStatus }[] | null) ?? []).map((c) => ({
      code: c.code,
      status: c.status,
    })),
  }));
}
