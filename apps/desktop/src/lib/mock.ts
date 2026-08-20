// Mock data + a tiny event bus, used only when the app is running outside a
// real Tauri window (e.g. `pnpm dev` opened in a plain browser tab, with no
// dongle attached). Lets the UI be previewed and iterated on without a car.
// See `src/lib/tauri.ts` for how this is switched in.

import type { ConnStatus, Live as LiveMap } from "@/shared/domain/connection";
import type { CarReport, KeyStat } from "@/features/vehicle/schema";
import type { ClearOutcome, UdsModule, UdsProbe } from "@/features/lab/schema";
import type { DtcResult, DtcScanRow, ObdClearOutcome, WriteLogRow } from "@/features/diagnose/schema";
import type { HistoryPoint } from "@/features/history/schema";
import type { SensorReading } from "@/features/live/schema";

const MOCK_VIN = "VR7BAHNSANE014974";

// ---------- tiny event bus (mirrors @tauri-apps/api/event's listen shape) ----------

type Listener<T> = (e: { event: string; id: number; payload: T }) => void;
const bus = new Map<string, Set<Listener<unknown>>>();
let eventId = 0;

function emit<T>(event: string, payload: T) {
  bus.get(event)?.forEach((cb) => cb({ event, id: ++eventId, payload }));
}

export function mockListen<T>(event: string, cb: Listener<T>): Promise<() => void> {
  if (!bus.has(event)) bus.set(event, new Set());
  const set = bus.get(event)!;
  set.add(cb as Listener<unknown>);
  return Promise.resolve(() => {
    set.delete(cb as Listener<unknown>);
  });
}

// ---------- fake "the car is idling" live loop ----------

let connState: ConnStatus = { state: "disconnected" };
// Starts undiscovered on purpose — mock mode's default scenario is "no
// vehicle yet," so the first connect walks through the real discovery flow
// (see DiscoveryFlow.tsx) instead of dropping straight into a populated
// dashboard. After that first connect, report_cars()/car_info() reveal the
// same seeded history as before — a pragmatic demo choice, not a claim that
// a freshly discovered car would already have 47 sessions of history.
let discovered = false;
let fuelPrice = 1.62;
let fuelLevel = 57; // %, drains gently over a demo session
let liveTimer: number | null = null;
let tick = 0;

const jitter = (base: number, spread: number) => base + (Math.random() - 0.5) * spread;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function genTick(): LiveMap {
  tick++;
  // Gentle idle with the occasional light rev, like a car sitting in a driveway.
  const revving = tick % 23 > 18;
  const rpm = revving ? jitter(1800, 400) : jitter(840, 60);
  const load = revving ? jitter(38, 10) : jitter(14, 4);
  const throttle = revving ? jitter(22, 8) : jitter(1.5, 1.5);
  fuelLevel = clamp(fuelLevel - 0.003, 4, 100);

  return {
    rpm: Math.round(rpm),
    speed: 0,
    coolant: clamp(88 + Math.sin(tick / 40) * 2, 20, 105),
    voltage: jitter(14.1, 0.25),
    load: clamp(load, 0, 100),
    throttle: clamp(throttle, 0, 100),
    intake_temp: jitter(29, 1.5),
    map: clamp(jitter(38, 4), 20, 105),
    stft: jitter(0.6, 1.2),
    ltft: jitter(-1.1, 0.8),
    fuel_rate: clamp(jitter(revving ? 1.1 : 0.55, 0.15), 0.3, 3),
    fuel_level: fuelLevel,
  };
}

function startLiveTicking() {
  if (liveTimer != null) return;
  emit<LiveMap>("live-update", genTick());
  liveTimer = window.setInterval(() => emit<LiveMap>("live-update", genTick()), 1000);
}

function stopLiveTicking() {
  if (liveTimer != null) {
    window.clearInterval(liveTimer);
    liveTimer = null;
  }
}

// ---------- mock car report (Overview / History) ----------

function buildDailyVoltage() {
  const days: { day: string; min: number; avg: number; max: number }[] = [];
  const today = new Date("2026-08-19T00:00:00Z");
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const avg = jitter(13.9, 0.15);
    days.push({
      day: d.toISOString().slice(0, 10),
      min: Number((avg - jitter(0.8, 0.3)).toFixed(2)),
      avg: Number(avg.toFixed(2)),
      max: Number((avg + jitter(0.6, 0.2)).toFixed(2)),
    });
  }
  return days;
}

function buildCarReport(): CarReport {
  const statsAll: KeyStat[] = [
    { key: "rpm", n: 48213, min: 720, avg: 1840, max: 5200 },
    { key: "speed", n: 48213, min: 0, avg: 41, max: 128 },
    { key: "coolant", n: 48213, min: 18, avg: 79, max: 97 },
    { key: "voltage", n: 48213, min: 11.9, avg: 14.0, max: 14.6 },
    { key: "load", n: 48213, min: 0, avg: 32, max: 96 },
    { key: "throttle", n: 48213, min: 0, avg: 12, max: 88 },
    { key: "intake_temp", n: 48213, min: 12, avg: 27, max: 41 },
    { key: "map", n: 48213, min: 28, avg: 52, max: 210 },
    { key: "stft", n: 48213, min: -6.2, avg: 0.4, max: 5.8 },
    { key: "ltft", n: 48213, min: -4.1, avg: -1.2, max: 2.9 },
    { key: "fuel_rate", n: 48213, min: 0, avg: 1.4, max: 6.8 },
  ];
  const stats7d = statsAll.map((s) => ({ ...s, n: Math.round(s.n * 0.06) }));

  return {
    vin: MOCK_VIN,
    insights: {
      window_hours: 24 * 7,
      engine_hours: 6.2,
      fuel_lph_avg: 1.7,
      speed_avg: 38,
      l_per_100km: 5.4,
      fuel_total_l: 10.5,
      km_total: 194,
      ltft_avg: -1.2,
      coolant_max: 92,
      coolant_reached_op: true,
      boost_max_kpa: 178,
      baro_kpa: 92,
      voltage_min: 12.1,
      voltage_avg: 14.0,
      fuel_price: fuelPrice,
      fuel_level_pct: fuelLevel,
    },
    session_count: 47,
    engine_minutes: 3120,
    total_readings: 812_940,
    first: "2026-06-02T08:14:00Z",
    last: "2026-08-19T07:40:00Z",
    scans_total: 6,
    scans_clean: 4, // matches DTC_HISTORY's story: P0420 stored + P0301 pending on recent scans
    sessions: Array.from({ length: 8 }, (_, i) => ({
      id: 47 - i,
      started_at: `2026-08-${String(19 - i).padStart(2, "0")}T07:4${i}:00Z`,
      ended_at: `2026-08-${String(19 - i).padStart(2, "0")}T08:1${i}:00Z`,
      readings: Math.round(jitter(2400, 400)),
      max_speed: Math.round(jitter(95, 25)),
      max_coolant: Math.round(jitter(91, 4)),
      min_voltage: Number(jitter(12.6, 0.4).toFixed(1)),
      minutes: Math.round(jitter(32, 10)),
    })),
    stats_7d: stats7d,
    stats_all: statsAll,
    daily_voltage: buildDailyVoltage(),
  };
}

// ---------- mock "all sensors" full scan ----------

const ALL_SENSORS: SensorReading[] = [
  { pid: "0104", key: "load", label: "Engine load", unit: "%", value: 14.5 },
  { pid: "0105", key: "coolant", label: "Coolant temp", unit: "°C", value: 88.0 },
  { pid: "0106", key: "stft", label: "Short fuel trim B1", unit: "%", value: 0.8 },
  { pid: "0107", key: "ltft", label: "Long fuel trim B1", unit: "%", value: -1.2 },
  { pid: "010B", key: "map", label: "Manifold pressure", unit: "kPa", value: 38.0 },
  { pid: "010C", key: "rpm", label: "Engine RPM", unit: "rpm", value: 842.0 },
  { pid: "010D", key: "speed", label: "Vehicle speed", unit: "km/h", value: 0.0 },
  { pid: "010E", key: "timing_adv", label: "Timing advance", unit: "°", value: 11.5 },
  { pid: "010F", key: "intake_temp", label: "Intake air temp", unit: "°C", value: 29.0 },
  { pid: "0111", key: "throttle", label: "Throttle position", unit: "%", value: 1.6 },
  { pid: "011F", key: "run_time", label: "Run time since start", unit: "s", value: 612.0 },
  { pid: "012F", key: "fuel_level", label: "Fuel level", unit: "%", value: 57.0 },
  { pid: "0133", key: "baro", label: "Barometric pressure", unit: "kPa", value: 92.0 },
  { pid: "0142", key: "ecu_voltage", label: "Control module voltage", unit: "V", value: 14.1 },
  { pid: "0146", key: "ambient_temp", label: "Ambient air temp", unit: "°C", value: 24.0 },
  { pid: "015C", key: "oil_temp", label: "Engine oil temp", unit: "°C", value: 91.0 },
  { pid: "015E", key: "fuel_rate", label: "Fuel rate", unit: "L/h", value: 0.55 },
];

// ---------- mock history points ----------

function buildHistory(key: string, hours: number): HistoryPoint[] {
  const base: Record<string, number> = {
    voltage: 14.0,
    coolant: 88,
    rpm: 900,
    speed: 30,
    load: 25,
  };
  const b = base[key] ?? 50;
  const n = Math.min(400, Math.max(30, Math.round(hours * 4)));
  const now = new Date("2026-08-19T08:00:00Z").getTime();
  return Array.from({ length: n }, (_, i) => {
    const ts = new Date(now - (n - i) * ((hours * 3600_000) / n));
    return { ts: ts.toISOString().replace("T", " ").slice(0, 19), value: Number(jitter(b, b * 0.08).toFixed(2)) };
  });
}

// ---------- diagnose ----------

// Seeded with a realistic fault story, not all-clean — so the Diagnose UI
// demonstrates what codes actually look like: a misfire appeared as pending
// in July, matured into a stored P0420 (catalyst efficiency) with the MIL
// on by mid-August, and older scans were clean.
const DTC_HISTORY: DtcScanRow[] = [
  { id: 6, ts: "2026-08-14 12:03:11", mil_on: true, dtc_count: 1, stored: ["P0420"], pending: ["P0301"], permanent: [], voltage: 13.1 },
  { id: 5, ts: "2026-07-30 09:41:02", mil_on: false, dtc_count: 0, stored: [], pending: ["P0301"], permanent: [], voltage: 12.9 },
  { id: 4, ts: "2026-07-11 18:22:47", mil_on: false, dtc_count: 0, stored: [], pending: [], permanent: [], voltage: 13.4 },
];

// Live demo fault state — STATEFUL on purpose: "Scan for codes" finds these,
// "Clear codes" genuinely erases them, and the verification re-scan then
// comes back clean, so the full two-way flow (this is not a read-only tool)
// can be exercised end to end in demo mode. Reset by reloading the page.
let demoFaults: { stored: string[]; pending: string[]; permanent: string[] } = {
  stored: ["P0420"],
  pending: ["P0301"],
  permanent: [],
};
let nextScanId = 7;

// ---------- write safety rail (mirrors the backend's writes_log) ----------

// Module faults for the Lab's ModuleFaults card, stateful like demoFaults:
// read shows them, a confirmed clear erases them. Keys match the mock
// uds_modules list below.
const demoModuleFaults: Record<string, string[]> = {
  engine: ["P0420"],
  bsi: ["U1109", "U1213"],
};

const MODULE_LABELS: Record<string, string> = {
  engine: "Engine (BSI)",
  bsi: "BSI (body)",
};

// In-memory stand-in for the writes_log table, so the Write history card
// works in the browser demo. Reset by reloading the page.
const WRITES: WriteLogRow[] = [];
let nextWriteId = 1;

function logMockWrite(row: Omit<WriteLogRow, "id" | "ts">) {
  WRITES.unshift({
    ...row,
    id: nextWriteId++,
    ts: new Date().toISOString().replace("T", " ").slice(0, 19),
  });
}

// Mirrors the backend's command-boundary guard: writes without
// `confirmed: true` refuse before touching anything.
function requireConfirmed(args?: Record<string, unknown>) {
  if (args?.confirmed !== true) {
    throw new Error("Write not confirmed. This action changes the car, so the app must show the confirmation step first.");
  }
}

// Freeze frame captured "when P0420 tripped" — moderate-load warm cruise,
// the classic catalyst-efficiency scenario. Keys match GAUGES in meta.ts.
const DEMO_FREEZE: Record<string, unknown> = {
  trigger_dtc: "P0420",
  rpm: 2260,
  speed: 74,
  coolant: 88,
  load: 41,
  map: 64,
  stft: 2.1,
  ltft: -1.0,
};

// ---------- entry point ----------
// (mock-mode detection itself now lives in tauri.ts, so this module can stay
// out of the eager bundle when it isn't needed — see tauri.ts for why.)

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await delay(90 + Math.random() * 160);

  switch (cmd) {
    case "conn_status":
      return connState as T;
    case "connect": {
      connState = { state: "connecting" };
      emit("conn-status", connState);
      await delay(900);
      connState = { state: "connected", elm_version: "STN2100 · demo data" };
      emit("conn-status", connState);
      startLiveTicking();
      discovered = true;
      return undefined as T;
    }
    case "disconnect": {
      stopLiveTicking();
      connState = { state: "disconnected" };
      emit("conn-status", connState);
      return undefined as T;
    }
    case "report_cars":
      return (discovered ? [[MOCK_VIN, 47]] : []) as T;
    case "car_report":
      return buildCarReport() as T;
    case "set_fuel_price":
      fuelPrice = Number(args?.price) || fuelPrice;
      return undefined as T;
    case "all_sensors":
      await delay(900);
      return ALL_SENSORS as T;
    case "dtc_history":
      return DTC_HISTORY as T;
    case "scan_dtcs": {
      await delay(600);
      const mil = demoFaults.stored.length > 0;
      const scan: DtcResult = {
        mil_on: mil,
        dtc_count: demoFaults.stored.length,
        stored: [...demoFaults.stored],
        pending: [...demoFaults.pending],
        permanent: [...demoFaults.permanent],
        voltage: 13.1,
        freeze: mil ? DEMO_FREEZE : null,
      };
      // Every scan lands in history, same as the real backend.
      DTC_HISTORY.unshift({
        ...scan,
        freeze: undefined,
        id: nextScanId++,
        ts: new Date().toISOString().replace("T", " ").slice(0, 19),
      });
      return scan as T;
    }
    case "readiness":
      return {
        misfire: true,
        fuel_system: true,
        components: true,
        catalyst: true,
        heated_catalyst: true,
        evap: true,
        secondary_air: true,
        o2_sensor: true,
        o2_heater: true,
        egr_vvt: true,
      } as T;
    case "clear_dtcs": {
      // Full safety-rail parity with the backend: refuses unconfirmed calls,
      // returns a verified before/after, logs the write. A real clear erases
      // stored+pending (permanent codes only self-erase after the car
      // verifies the fix — none in the demo).
      requireConfirmed(args);
      await delay(600);
      const snapshot = (): DtcResult => ({
        mil_on: demoFaults.stored.length > 0,
        dtc_count: demoFaults.stored.length,
        stored: [...demoFaults.stored],
        pending: [...demoFaults.pending],
        permanent: [...demoFaults.permanent],
        voltage: 13.1,
        freeze: null,
      });
      const before = snapshot();
      demoFaults = { stored: [], pending: [], permanent: [] };
      const after = snapshot();
      // The backend's verification scan lands in dtc_scans history; mirror it.
      DTC_HISTORY.unshift({
        ...after,
        freeze: undefined,
        id: nextScanId++,
        ts: new Date().toISOString().replace("T", " ").slice(0, 19),
      });
      const strip = (r: DtcResult) => ({ mil_on: r.mil_on, stored: r.stored, pending: r.pending, permanent: r.permanent });
      logMockWrite({
        module: "Engine (OBD)",
        action: "clear_dtcs",
        params: { mode: "04" },
        before: strip(before),
        after: strip(after),
        outcome: after.stored.length + after.pending.length === 0 ? "cleared" : "faults_remain",
        error: null,
      });
      return { before, after } as ObdClearOutcome as T;
    }
    case "reading_keys":
      return ["fuel_level"] as T;
    case "history":
      return buildHistory(String(args?.key ?? "voltage"), Number(args?.sinceHours ?? 24)) as T;
    case "car_info":
      return (discovered
        ? [
            ["vin", MOCK_VIN],
            ["make", "Citroën"],
            ["model", "C4 III"],
            ["year", "2023"],
            ["fuel_price", String(fuelPrice)],
          ]
        : []) as T;
    case "db_path":
      return "~/Library/Application Support/com.cxalem.scainner/scainner.sqlite3 (demo mode — no real file)" as T;
    case "read_ecu_info":
      return { vin: MOCK_VIN, protocol: "ISO 15765-4 CAN 11-bit 500k", elm_version: "STN2100" } as T;
    case "export_json":
      return JSON.stringify({ demo: true, note: "Mock export — connect a real dongle for real data." }, null, 2) as T;
    case "ai_context":
      return "# Demo AI context\n\nThis is mock data for UI preview — connect Scainner to a real vehicle for the real briefing." as T;
    case "uds_modules":
      return [
        { key: "engine", label: "Engine (BSI)", req: "10DA", resp: "10DA", builtin: true },
        { key: "bsi", label: "BSI (body)", req: "1200", resp: "1200", builtin: true },
      ] as UdsModule[] as T;
    case "list_probes":
      return [] as UdsProbe[] as T;
    case "add_probe":
    case "toggle_probe":
    case "delete_probe":
    case "add_uds_module":
    case "delete_uds_module":
    case "uds_cancel_scan":
      return undefined as T;
    case "uds_read":
      return null as T;
    case "uds_module_dtcs":
      await delay(500);
      return [...(demoModuleFaults[String(args?.module ?? "")] ?? [])] as T;
    case "uds_clear": {
      // Same rail as the real backend. This used to return `{ cleared: 0 }`,
      // which was never the ClearOutcome shape ModuleFaults expects — a mock
      // parity bug (engineering.md rule 3), fixed as part of this stream.
      requireConfirmed(args);
      await delay(800);
      const key = String(args?.module ?? "");
      const before = [...(demoModuleFaults[key] ?? [])];
      demoModuleFaults[key] = [];
      logMockWrite({
        module: MODULE_LABELS[key] ?? key,
        action: "clear_faults",
        params: { service: "14", group: "FFFFFF" },
        before,
        after: [],
        outcome: "cleared",
        error: null,
      });
      return { before, accepted: true, after: [] } as ClearOutcome as T;
    }
    case "writes_log":
      return WRITES.slice(0, Number(args?.limit ?? 20)) as T;
    case "uds_scan":
      return [] as T;
    default:
      return undefined as T;
  }
}
