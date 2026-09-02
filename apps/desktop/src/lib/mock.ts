// Mock data + a tiny event bus, used only when the app is running outside a
// real Tauri window (e.g. `pnpm dev` opened in a plain browser tab, with no
// dongle attached). Lets the UI be previewed and iterated on without a car.
// See `src/lib/tauri.ts` for how this is switched in.

import { PIN_REQUIRED } from "@scainner/core";
import type { AdapterProfile, ConnStatus, Live as LiveMap } from "@scainner/core";
import type { CarReport, KeyStat } from "@scainner/core";
import type { ClearOutcome, UdsModule, UdsProbe } from "@scainner/core";
import type { DtcResult, DtcScanRow, ObdClearOutcome, WriteLogRow } from "@scainner/core";
import type { HistoryPoint } from "@scainner/core";
import type { SensorReading } from "@scainner/core";
// The UDS knowledge pack (packages/uds-map/data/uds-map.json). Every demo
// vehicle, module address, DID and plan name below is derived from it at
// module-load time, so the demo carries no brand-specific literals. mock.ts
// is only ever loaded in the browser preview, never in the Tauri bundle.
import udsMap from "../../../../packages/uds-map/data/uds-map.json";

// ---------- pack-derived demo vehicles ----------

type PackModule = { req: string; resp: string; name: string };
type PackDid = {
  did: string;
  label: string;
  modules?: { req: string; resp: string }[];
  discriminating_test?: string;
  decodes?: { discriminating_test?: string }[];
};
type PackBrand = {
  id: string;
  name: string;
  wmi: string[];
  modules?: PackModule[];
  known_dids?: PackDid[];
  did_bands?: { from: string; to: string }[];
};

const PACK_BRANDS = (udsMap as unknown as { brands: PackBrand[] }).brands;

type DemoVehicle = {
  id: number;
  vin: string;
  make: string;
  brand: PackBrand;
  modules: PackModule[];
  uds_modules: UdsModule[];
};

const moduleKey = (m: { req: string; resp: string }) => `${m.req}_${m.resp}`.toLowerCase();
const moduleAddress = (m: { req: string; resp: string }) => `${m.req}/${m.resp}`.toUpperCase();
const moduleRoute = (m: { req: string; resp: string }) => `${m.req}→${m.resp}`.toUpperCase();
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
const parseHex = (s: string) => parseInt(s, 16);
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "condition";

// ISO 14229 identity DIDs (standard, brand-independent).
const ISO_IDENTITY: { did: number; purpose: string }[] = [
  { did: 0xf186, purpose: "active diagnostic session" },
  { did: 0xf187, purpose: "spare part number" },
  { did: 0xf18a, purpose: "system supplier" },
];

const DEMO_VEHICLES: DemoVehicle[] = PACK_BRANDS.filter((b) => (b.modules?.length ?? 0) > 0 && b.wmi.length > 0)
  .slice(0, 3)
  .map((brand, i) => {
    const id = i + 1;
    const vin = `${brand.wmi[0]}EXAMPLE`.padEnd(16, "0") + String(id);
    const make = brand.name.split(/ \/| \(/)[0].trim();
    const modules = brand.modules ?? [];
    return {
      id,
      vin,
      make,
      brand,
      modules,
      uds_modules: modules.map((m) => ({ key: moduleKey(m), label: m.name, req: m.req, resp: m.resp, builtin: true })),
    };
  });

const CONNECTED = DEMO_VEHICLES[0];
const MOCK_VIN = CONNECTED.vin;

function vehicleFor(args?: Record<string, unknown>): DemoVehicle {
  const id = Number(args?.vehicleId ?? CONNECTED.id);
  return DEMO_VEHICLES.find((v) => v.id === id) ?? CONNECTED;
}

const didText = (d: PackDid) => d.discriminating_test ?? d.decodes?.find((x) => x.discriminating_test)?.discriminating_test;
const didsBoundTo = (brand: PackBrand, m: PackModule) =>
  (brand.known_dids ?? []).filter((d) => d.modules?.some((x) => x.req === m.req && x.resp === m.resp));

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
let adapterProfile: AdapterProfile = {
  kind: "elm_serial",
  path: null,
  bt_addr: null,
  pin: "1234",
  host: null,
  port: 35000,
  baud: 115200,
  timing: "default",
};
// The two radios a scan "finds" in the preview: one with a friendly name,
// one that answered without one (so the UI's address fallback is visible).
// They pair differently on purpose — the named one does Secure Simple
// Pairing and needs no code, the unnamed one asks for a PIN the first time,
// so both halves of the pair flow are reachable in the preview.
const NEARBY_IN_PREVIEW = [
  { addr: "aa-bb-cc-dd-ee-11", name: "OBD Reader 4821", paired: false },
  { addr: "aa-bb-cc-dd-ee-12", name: null, paired: false },
];
/** The preview's PIN-less radio: `--pair` alone is enough for this one. */
const PAIRS_WITHOUT_PIN = "aa-bb-cc-dd-ee-11";
/** Addresses that have already been asked for a code this session, so the
 *  request happens once and the retry with the PIN succeeds. */
const askedForPin = new Set<string>();
// What the preview has paired this session — appended to list_adapters so
// a paired device becomes an ordinary row, exactly as it does for real.
const pairedInPreview: Record<string, unknown>[] = [];
// Starts undiscovered on purpose — mock mode's default scenario is "no
// vehicle yet," so the first connect walks through the real discovery flow
// (see DiscoveryFlow.tsx) instead of dropping straight into a populated
// dashboard. After that first connect, report_cars()/car_info() reveal the
// same seeded history as before — a pragmatic demo choice, not a claim that
// a freshly discovered car would already have 47 sessions of history.
let discovered = false;
// The knowledge key the preview pretends to ship, and whether the demo car
// has already been scanned with it — the run-once gate, mocked, so the
// second demo connect exercises the "skipped" state the way a real second
// connect does.
const MOCK_KNOWLEDGE_KEY = "k1;map=9@2026-08-28;research=demo@1;packs=demo@1;plan=1";
let autoScanDoneAt: string | null = null;

const sqlNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** Walks the four protocol stages on conn-status, then records the run. */
async function runMockAutoScan(): Promise<void> {
  const started_at = sqlNow();
  const stages = [
    { stage: "census" as const, total: 12 },
    { stage: "identity" as const, total: 6 },
    { stage: "join" as const, total: 1 },
    { stage: "coverage" as const, total: 1 },
  ];
  for (const { stage, total } of stages) {
    connState = {
      ...connState,
      scanning: true,
      discovery: {
        state: "running",
        reason: autoScanDoneAt ? "requested" : "never_run",
        stage,
        stage_done: 0,
        stage_total: total,
        started_at,
        last_run_at: autoScanDoneAt,
        knowledge_key: MOCK_KNOWLEDGE_KEY,
      },
    };
    emit("conn-status", connState);
    await delay(900);
  }
  autoScanDoneAt = sqlNow();
  connState = {
    ...connState,
    scanning: false,
    discovery: {
      state: "done",
      reason: "never_run",
      started_at,
      last_run_at: autoScanDoneAt,
      knowledge_key: MOCK_KNOWLEDGE_KEY,
    },
  };
  emit("conn-status", connState);
}
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

function buildCarReport(v: DemoVehicle): CarReport {
  // Vehicle 1 carries the full seeded history; the others scale it down so
  // switching vehicles visibly changes the numbers.
  const f = 1 / v.id;
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
  ].map((s) => ({ ...s, n: Math.round(s.n * f) }));
  const stats7d = statsAll.map((s) => ({ ...s, n: Math.round(s.n * 0.06) }));
  const sessionCount = Math.round(47 * f);

  return {
    vehicle_id: v.id,
    vin: v.vin,
    display_name: null,
    insights: {
      window_hours: 24 * 7,
      engine_hours: Number((6.2 * f).toFixed(1)),
      fuel_lph_avg: 1.7,
      speed_avg: 38,
      l_per_100km: 5.4,
      fuel_total_l: Number((10.5 * f).toFixed(1)),
      km_total: Math.round(194 * f),
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
    session_count: sessionCount,
    engine_minutes: Math.round(3120 * f),
    total_readings: Math.round(812_940 * f),
    first: "2026-06-02T08:14:00Z",
    last: "2026-08-19T07:40:00Z",
    scans_total: v.id === CONNECTED.id ? 6 : 1,
    scans_clean: v.id === CONNECTED.id ? 4 : 1, // vehicle 1 matches DTC_HISTORY's story: P0420 stored + P0301 pending on recent scans
    sessions: Array.from({ length: Math.min(8, sessionCount) }, (_, i) => ({
      id: sessionCount - i,
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

// ---------- reading keys (the Over-time sensor browser) ----------

// One row per key the demo car has ever recorded: the standard gauges, then
// a probe key per pack-known DID on each of its modules. `last_ts` is spread
// across the last few weeks so the browser's "in this range" dot and the
// "show all" tail both have something to show.
type MockReadingKey = {
  key: string;
  label: string | null;
  unit: string | null;
  module_key: string | null;
  module_name: string | null;
  source: "standard" | "probe";
  probe_id: number | null;
  last_ts: string | null;
};

const MOCK_NOW = new Date("2026-08-19T08:00:00Z").getTime();
const minutesAgo = (m: number) => new Date(MOCK_NOW - m * 60_000).toISOString().replace("T", " ").slice(0, 19);

function readingKeyDetails(args?: Record<string, unknown>): MockReadingKey[] {
  const v = vehicleFor(args);
  const standard: MockReadingKey[] = ["voltage", "coolant", "rpm", "speed", "load", "fuel_level"].map((key, i) => ({
    key,
    label: null,
    unit: null,
    module_key: null,
    module_name: "Standard",
    source: "standard",
    probe_id: null,
    last_ts: minutesAgo(i * 4),
  }));
  let probeId = 0;
  const probes: MockReadingKey[] = v.modules.flatMap((m) =>
    didsBoundTo(v.brand, m)
      .slice(0, 5)
      .map((d) => {
        probeId += 1;
        // Every third key last answered weeks ago, so it sits in the tail.
        const age = probeId % 3 === 0 ? 60 * 24 * 20 + probeId : probeId * 37;
        return {
          key: `uds_${slug(d.label)}`,
          label: d.label,
          unit: null,
          module_key: moduleKey(m),
          module_name: m.name,
          source: "probe" as const,
          probe_id: probeId,
          last_ts: minutesAgo(age),
        };
      }),
  );
  return [...standard, ...probes];
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

type MockDiagnosticCase = {
  id: number; cloud_id: string; vehicle_id: number; reference: string;
  status: "open" | "in_progress" | "waiting" | "completed" | "cancelled";
  complaint: string; odometer_km: number | null; assigned_to: string | null;
  opened_at: string; updated_at: string; closed_at: string | null;
};
const DIAGNOSTIC_CASES: MockDiagnosticCase[] = [];

// ---------- write safety rail (mirrors the backend's writes_log) ----------

// Module faults for the Lab's ModuleFaults card, stateful like demoFaults:
// read shows them, a confirmed clear erases them. Keyed by the connected
// vehicle's pack-derived module keys (first module: a powertrain-style code,
// second: network codes).
const demoModuleFaults: Record<string, string[]> = Object.fromEntries(
  CONNECTED.uds_modules.slice(0, 2).map((m, i) => [m.key, i === 0 ? ["P0420"] : ["U1109", "U1213"]]),
);

const MODULE_LABELS: Record<string, string> = Object.fromEntries(
  DEMO_VEHICLES.flatMap((v) => v.uds_modules.map((m) => [m.key, m.label])),
);

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

// ---------- pack-derived Lab payloads ----------

const DEMO_IDENTITY = {
  spare_part_number: "DEMO-PART-0001",
  hardware_version: "HW01",
  software_version: "SW1.0",
};
const identityFor = (m: PackModule) => ({
  ...DEMO_IDENTITY,
  system_name: m.name,
  match_key: `part=${DEMO_IDENTITY.spare_part_number}|hw=${DEMO_IDENTITY.hardware_version}|sw=${DEMO_IDENTITY.software_version}|sys=${m.name}`,
});

const answered = (service: string) => ({ status: "answered", service, nrc: null, detail: null });

function buildParkedPlan(v: DemoVehicle) {
  const band = v.brand.did_bands?.[0];
  return {
    plan_version: `${v.brand.id}-unknown-v1`,
    brand_id: v.brand.id,
    platform: null,
    targets: v.modules.slice(0, 2).map((m, i) => ({
      key: moduleKey(m),
      label: m.name,
      expected_family: m.name,
      req: m.req,
      resp: m.resp,
      route: { protocol: "can11_500" as const, req: m.req, resp: m.resp },
      read_service: "22" as const,
      dids: ISO_IDENTITY.map((d) => ({ ...d })),
      sweep: i === 0 && band ? [[parseHex(band.from), parseHex(band.to)] as [number, number]] : [],
      source: "knowledge map (demo)",
    })),
    sweep_budget_secs: 240,
  };
}

function buildParkedVerification(v: DemoVehicle) {
  const outcomes = [
    { outcome: answered("22"), payload_hex: "01", raw_response: "62 F1 86 01\r>" },
    { outcome: { status: "refused", service: "22", nrc: 49, detail: "request out of range" }, payload_hex: null, raw_response: "7F 22 31\r>" },
    { outcome: { status: "timed_out", service: "22", nrc: null, detail: null }, payload_hex: null, raw_response: "NO DATA\r>" },
  ];
  return {
    run_id: 12,
    plan_version: `${v.brand.id}-unknown-v1`,
    safety: "parked, read-only 0x22 requests, default diagnostic session",
    targets: v.modules.slice(0, 2).map((m, ti) => ({
      key: moduleKey(m),
      label: m.name,
      expected_family: m.name,
      route: moduleRoute(m),
      evidence_source: "knowledge map entry; requires vehicle verification",
      summary: null,
      observations: ISO_IDENTITY.slice(0, ti === 0 ? 2 : 1).map((d, i) => ({
        did: hex4(d.did),
        purpose: d.purpose,
        ...outcomes[(ti + i) % outcomes.length],
        printable: null,
        candidate_interpretations: [],
      })),
    })),
  };
}

type GuidedStep = {
  id: string;
  kind: "baseline" | "input";
  module: string | null;
  hypotheses: string[];
  precondition: Record<string, string | boolean>;
  instruction: string;
  condition_label: string;
  capture: { dids: string[]; reference_dids: Record<string, string[]>; repeats: number; hold_seconds: number };
  success: { expected: Record<string, string>; returns_after: boolean };
  applicable_if: Record<string, string>;
  optional: boolean;
  operator_confirmation: string | null;
  safety: string;
  estimated_seconds: number;
  on_success: string | null;
  on_failure: string | null;
};

function buildGuidedSteps(v: DemoVehicle) {
  const known = v.brand.known_dids ?? [];
  const withTest = known.filter((d) => didText(d));
  const picked = (withTest.length > 0 ? withTest : known).slice(0, 2);
  const repeats = 3;
  const safety = "read-only 0x22 requests; vehicle parked, engine off unless the instruction says otherwise";

  const moduleOf = (d: PackDid) => (d.modules?.[0] ? moduleAddress(d.modules[0]) : null);
  const referencesFor = (d: PackDid) =>
    known
      .filter((o) => o !== d && o.modules?.[0] && d.modules?.[0] && moduleAddress(o.modules[0]) === moduleAddress(d.modules[0]))
      .slice(0, 3)
      .map((o) => o.did.toUpperCase());

  const baseline = (id: string, d: PackDid, next: string | null): GuidedStep => ({
    id,
    kind: "baseline",
    module: moduleOf(d),
    hypotheses: [],
    precondition: { parked: true, ignition: "on" },
    instruction: "Leave the vehicle at rest with no driver input, then capture.",
    condition_label: "baseline",
    capture: {
      dids: [d.did.toUpperCase()],
      reference_dids: {},
      repeats,
      hold_seconds: 0,
    },
    success: { expected: {}, returns_after: false },
    applicable_if: {},
    optional: false,
    operator_confirmation: null,
    safety,
    estimated_seconds: 15,
    on_success: next,
    on_failure: null,
  });

  const input = (d: PackDid, n: number, next: string): GuidedStep => {
    const did = d.did.toUpperCase();
    const text = didText(d) ?? "Hold the condition described by the hypothesis, then capture.";
    return {
      id: `input_${n}`,
      kind: "input",
      module: moduleOf(d),
      hypotheses: [did],
      precondition: { parked: true, ignition: "on" },
      instruction: text,
      condition_label: slug(text),
      capture: { dids: [did], reference_dids: { [did]: referencesFor(d) }, repeats, hold_seconds: 5 },
      success: { expected: { [did]: "changes_from_baseline" }, returns_after: true },
      applicable_if: {},
      optional: false,
      operator_confirmation: "Confirm the condition is held before capturing.",
      safety,
      estimated_seconds: 30,
      on_success: next,
      on_failure: null,
    };
  };

  // One independent triplet per experiment, chained in order (same shape
  // as the backend's generator): before-baseline, input, after-baseline.
  const steps: GuidedStep[] = [];
  picked.forEach((d, i) => {
    const n = i + 1;
    const next = i + 1 < picked.length ? `baseline_before_${n + 1}` : null;
    steps.push(baseline(`baseline_before_${n}`, d, `input_${n}`));
    steps.push(input(d, n, `baseline_after_${n}`));
    steps.push(baseline(`baseline_after_${n}`, d, next));
  });

  return {
    vehicle_id: v.id,
    plan_version: `${v.brand.id}-unknown-corr-v1`,
    repeats,
    facts: { vin_known: true, brand: v.brand.id, platform: null, gearbox: "unknown" },
    steps,
  };
}

function buildEvidenceModule(v: DemoVehicle) {
  const m = v.modules[0];
  return {
    id: 1,
    address: moduleAddress(m),
    display_name: m.name,
    name_source: "ecu_reported",
    presence: "previously_reached",
    first_seen_at: "2026-08-24 10:00:00",
    last_seen_at: "2026-08-25 18:30:00",
    identity: { ...DEMO_IDENTITY, system_name: m.name, fields_answered: 4, fields_total: 4 },
    dids: [{ did: ISO_IDENTITY[1].did, raw_sample: "44454D4F2D504152542D30303031", byte_length: 14, label: "Spare part number", confidence: "confirmed" }],
    module_fault_evidence: "not_scanned",
  };
}

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
      // The same four stages the backend pipeline walks, so the gate's
      // stage labels are exercised in the browser preview too.
      for (const stage of ["link", "open", "handshake", "bus"] as const) {
        connState = { state: "connecting", stage };
        emit("conn-status", connState);
        await delay(300);
      }
      // First demo connect reports vehicle_is_new (schema v2), so the
      // discovery flow runs in the browser preview too.
      const isNew = !discovered;
      connState = {
        state: "connected",
        elm_version: "STN2100 · demo data",
        vin: MOCK_VIN,
        vehicle_id: CONNECTED.id,
        display_name: null,
        vehicle_is_new: isNew,
      };
      emit("conn-status", connState);
      startLiveTicking();
      discovered = true;
      // Same gate as the backend's: the first connect scans, every later
      // one skips because the maps have not moved.
      if (autoScanDoneAt == null) {
        void runMockAutoScan();
      } else {
        connState = {
          ...connState,
          discovery: {
            state: "skipped",
            reason: "knowledge_unchanged",
            last_run_at: autoScanDoneAt,
            knowledge_key: MOCK_KNOWLEDGE_KEY,
          },
        };
        emit("conn-status", connState);
      }
      return undefined as T;
    }
    case "disconnect": {
      stopLiveTicking();
      connState = { state: "disconnected" };
      emit("conn-status", connState);
      return undefined as T;
    }
    case "list_adapters":
      // Shaped like the enriched backend payload: one row per physical
      // device, a Bluetooth node, a bare USB node, one radio the OS has
      // not exposed a serial node for — and anything paired from the
      // device screen during this preview session.
      return [
        ...pairedInPreview,
        {
          kind: "serial",
          id: "/dev/cu.OBDLinkMX49489",
          name: "cu.OBDLinkMX49489",
          likely_obd: true,
          connected: true,
          display_name: "OBDLink MX+ 49489",
          device_kind: "bluetooth_serial",
          path: "/dev/cu.OBDLinkMX49489",
          bt_addr: "aa-bb-cc-dd-ee-01",
          last_used: true,
        },
        {
          kind: "serial",
          id: "/dev/cu.usbserial-1410",
          name: "cu.usbserial-1410",
          likely_obd: true,
          connected: null,
          display_name: "USB serial adapter",
          device_kind: "usb_serial",
          path: "/dev/cu.usbserial-1410",
          bt_addr: null,
          last_used: false,
        },
        {
          kind: "bluetooth",
          id: "aa-bb-cc-dd-ee-02",
          name: "V-LINK",
          likely_obd: true,
          connected: false,
          display_name: "V-LINK",
          device_kind: "paired_only",
          path: null,
          bt_addr: "aa-bb-cc-dd-ee-02",
          last_used: false,
        },
      ] as T;
    case "discover_adapters": {
      // The real inquiry blocks for about 8 s; 2 s is enough to see the
      // scanning row without making the preview tedious.
      await delay(2000);
      return NEARBY_IN_PREVIEW.filter(
        (device) => !pairedInPreview.some((row) => row.bt_addr === device.addr),
      ) as T;
    }
    case "pair_adapter": {
      await delay(1200);
      const addr = String(args?.addr ?? "");
      const pin = args?.pin == null ? null : String(args.pin);
      const found = NEARBY_IN_PREVIEW.find((device) => device.addr === addr);
      if (!found) throw new Error(`no device at ${addr}`);
      // The backend's two failures, in the shape the UI reads them: a radio
      // that wants a code says so once (and only for the attempt that
      // carried none), and a wrong code is an ordinary failure.
      if (pin === null && addr !== PAIRS_WITHOUT_PIN && !askedForPin.has(addr)) {
        askedForPin.add(addr);
        throw new Error(`${PIN_REQUIRED}: Type pin code (up to 16 characters) for "${addr}"`);
      }
      if (pin !== null && pin !== "1234") throw new Error(`pairing ${addr} failed`);
      // Pairing gives the OS a serial node, so the device joins the list
      // as an ordinary connectable row rather than a paired-only one.
      pairedInPreview.push({
        kind: "serial",
        id: `/dev/cu.${(found.name ?? addr).replace(/[^A-Za-z0-9]/g, "")}`,
        name: `cu.${(found.name ?? addr).replace(/[^A-Za-z0-9]/g, "")}`,
        likely_obd: true,
        connected: true,
        display_name: found.name ?? addr,
        device_kind: "bluetooth_serial",
        path: `/dev/cu.${(found.name ?? addr).replace(/[^A-Za-z0-9]/g, "")}`,
        bt_addr: addr,
        last_used: false,
      });
      return undefined as T;
    }
    case "get_adapter_profile":
      return adapterProfile as T;
    case "set_adapter_profile":
      adapterProfile = args?.profile as AdapterProfile;
      return adapterProfile as T;
    case "list_vehicles":
      return (discovered
        ? DEMO_VEHICLES.map((v) => ({ id: v.id, vin: v.vin, display_name: null, connections: Math.round(47 / v.id) }))
        : []) as T;
    case "vehicle_report":
      return buildCarReport(vehicleFor(args)) as T;
    case "vehicle_info": {
      const v = vehicleFor(args);
      return (discovered
        ? {
            id: v.id,
            vin: v.vin,
            display_name: null,
            make: v.make,
            model: null,
            year: 2024 - v.id,
            trim: null,
            fuel_price: fuelPrice,
            created_at: "2026-08-14 12:39:33",
            first_connected_at: "2026-08-14 12:39:33",
          }
        : null) as T;
    }
    case "set_vehicle_name":
    case "name_current_vehicle":
      return CONNECTED.id as T;
    case "set_fuel_price":
      fuelPrice = Number(args?.price) || fuelPrice;
      return undefined as T;
    case "all_sensors":
      await delay(900);
      return ALL_SENSORS as T;
    case "dtc_history":
      return DTC_HISTORY as T;
    case "diagnostic_cases":
      return DIAGNOSTIC_CASES.filter((item) => args?.vehicleId == null || item.vehicle_id === Number(args.vehicleId)) as T;
    case "create_diagnostic_case": {
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      const item: MockDiagnosticCase = {
        id: DIAGNOSTIC_CASES.length + 1,
        cloud_id: crypto.randomUUID(),
        vehicle_id: Number(args?.vehicleId),
        reference: `JOB-${String(DIAGNOSTIC_CASES.length + 1).padStart(4, "0")}`,
        status: "open",
        complaint: String(args?.complaint ?? ""),
        odometer_km: args?.odometerKm == null ? null : Number(args.odometerKm),
        assigned_to: args?.assignedTo == null ? null : String(args.assignedTo),
        opened_at: now,
        updated_at: now,
        closed_at: null,
      };
      DIAGNOSTIC_CASES.unshift(item);
      return item as T;
    }
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
      return {
        before,
        after,
        outcome: { status: "answered", service: "04", nrc: null, detail: null },
      } as ObdClearOutcome as T;
    }
    case "reading_keys":
      return readingKeyDetails(args).map((r) => r.key) as T;
    case "reading_key_details":
      return readingKeyDetails(args) as T;
    case "history":
      return buildHistory(String(args?.key ?? "voltage"), Number(args?.sinceHours ?? 24)) as T;
    case "db_path":
      return "~/Library/Application Support/com.cxalem.scainner/scainner.sqlite3 (demo mode — no real file)" as T;
    case "read_ecu_info":
      return { vin: MOCK_VIN, protocol: "ISO 15765-4 CAN 11-bit 500k", elm_version: "STN2100" } as T;
    case "export_json":
      return JSON.stringify({ demo: true, note: "Mock export — connect a real dongle for real data." }, null, 2) as T;
    case "ai_context":
      return "# Demo AI context\n\nThis is mock data for UI preview — connect Scainner to a real vehicle for the real briefing." as T;
    case "uds_modules":
      return vehicleFor(args).uds_modules as T;
    case "list_probes":
      return [] as UdsProbe[] as T;
    case "add_probe":
    case "toggle_probe":
    case "delete_probe":
    case "add_uds_module":
    case "delete_uds_module":
    case "uds_cancel_scan":
      return undefined as T;
    case "parked_plan":
      return buildParkedPlan(vehicleFor(args)) as T;
    case "guided_steps":
      return buildGuidedSteps(vehicleFor(args)) as T;
    case "correlation_capture": {
      await delay(600);
      const v = vehicleFor(args);
      const a = args as { dids?: number[]; condition?: string; step?: string; planVersion?: string; repeats?: number };
      const condition = a.condition ?? "baseline";
      const first = v.modules[0];
      const bound = didsBoundTo(v.brand, first).map((d) => parseHex(d.did));
      const dids = a.dids && a.dids.length > 0 ? a.dids : bound.slice(0, 5);
      // The DID that visibly "moves" under a non-baseline condition: the first
      // known DID bound to this module, else whatever was asked for first.
      const movedDid = bound[0] ?? dids[0];
      return {
        run_id: 21,
        plan_version: a.planVersion ?? `${v.brand.id}-unknown-corr-v1`,
        route: moduleRoute(first),
        step: a.step ?? "baseline",
        condition,
        repeats: a.repeats ?? 3,
        safety: "read-only",
        readings: dids.map((did) => {
          const moved = condition !== "baseline" && did === movedDid;
          const value = moved ? "0B" : "07";
          return { did: hex4(did), payloads: [value, value, value], stable: true, outcome: answered("22") };
        }),
      } as T;
    }
    case "parked_verification":
      await delay(500);
      return buildParkedVerification(vehicleFor(args)) as T;
    case "run_discovery": {
      const triggered = connState.state === "connected";
      autoScanDoneAt = null;
      if (triggered) void runMockAutoScan();
      return {
        triggered,
        cleared: true,
        knowledge_key: MOCK_KNOWLEDGE_KEY,
        detail: triggered
          ? "the scan ran on the connected car"
          : "this vehicle is not the connected one, so the scan runs on its next connection",
      } as T;
    }
    case "discover_sensors": {
      // Mirror the backend's global status broadcast so switching between
      // Lab and Live during a demo scan exercises the real architecture.
      connState = { ...connState, scanning: true };
      emit("conn-status", connState);
      await delay(600);
      connState = { ...connState, scanning: false };
      emit("conn-status", connState);
      const v = vehicleFor(args);
      const probed = v.modules.slice(0, 3);
      const results = [answered("22"), { status: "refused", service: "22", nrc: 0x31, detail: "requestOutOfRange" }, { status: "timed_out", service: "22", nrc: null, detail: null }];
      const first = probed[0];
      return {
        outcome: { status: "answered", service: "discovery", nrc: null, detail: null },
        coverage: {
          candidates_total: probed.length,
          candidates_attempted: probed.length,
          candidates_skipped: 0,
          profile_candidates: probed.length,
          profile_reached: 1,
          reached: 1,
          refused: probed.length > 1 ? 1 : 0,
          timed_out: probed.length > 2 ? 1 : 0,
          transport_failed: 0,
          malformed: 0,
        },
        module_probes: probed.map((m, i) => ({
          request_address: m.req,
          response_address: m.resp,
          expected_name: m.name,
          profile_candidate: true,
          source: "profile",
          outcome: results[i],
        })),
        fingerprints: [{
          request_address: first.req,
          response_address: first.resp,
          ...identityFor(first),
          fields_answered: 4,
          fields_total: 4,
          evidence: [],
        }],
        modules_found: 1,
        dids_found: 2,
        sensors_added: 1,
        cancelled: false,
        auto_stopped_reason: null,
        was_fast_refresh: false,
      } as T;
    }
    case "discovered_modules": {
      const m = vehicleFor(args).modules[0];
      const identity = identityFor(m);
      return [{
        id: 1, address: moduleAddress(m), name: m.name,
        discovered_at: "2026-08-24 10:00:00", last_seen_at: "2026-08-25 18:30:00",
        did_count: 2, labeled_count: 1,
        spare_part_number: identity.spare_part_number, hardware_version: identity.hardware_version,
        software_version: identity.software_version, system_name: identity.system_name,
        fingerprint_match_key: identity.match_key,
        fingerprint_fields_answered: 4, fingerprint_fields_total: 4,
      }] as T;
    }
    case "discovered_dids":
      return [] as T;
    case "fingerprint_experiment": {
      const m = CONNECTED.modules[0];
      return {
        target_vehicles: 30, vehicles_scanned: 3, vehicles_with_fingerprints: 2,
        modules_observed: 12, modules_with_fingerprints: 8, modules_with_part_number: 5,
        repeated_family_groups: 1, vehicles_with_repeated_family: 2,
        cohort_target_reached: false,
        match_groups: [{
          family_key: DEMO_IDENTITY.spare_part_number.replace(/[^A-Za-z0-9]/g, ""), part_number: DEMO_IDENTITY.spare_part_number,
          vehicle_count: 2, module_count: 2, hardware_versions: [DEMO_IDENTITY.hardware_version],
          software_versions: [DEMO_IDENTITY.software_version], system_names: [m.name],
        }],
        observations: [],
      } as T;
    }
    case "vehicle_evidence_map": {
      const v = vehicleFor(args);
      return {
        vehicle_id: v.id,
        evidence_scope: "persisted_observations",
        modules: [buildEvidenceModule(v)],
        latest_standard_faults: {
          scanned_at: "2026-08-25 18:31:00", mil_on: false,
          stored: [], pending: [], permanent: [],
        },
      } as T;
    }
    case "uds_read_many": {
      // Reference reads for a guided step: every asked DID answers with a
      // stable placeholder payload.
      const dids = ((args?.dids as number[] | undefined) ?? []).slice(0, 64);
      return dids.map((did) => ({ did, hex: "00 00", ascii: ".." })) as T;
    }
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
      return {
        before,
        accepted: true,
        refusal_reason: null,
        after: [],
        outcome: { status: "answered", service: "14", nrc: null, detail: null },
      } as ClearOutcome as T;
    }
    case "writes_log":
      return WRITES.slice(0, Number(args?.limit ?? 20)) as T;
    case "uds_scan":
      connState = { ...connState, scanning: true };
      emit("conn-status", connState);
      await delay(600);
      connState = { ...connState, scanning: false };
      emit("conn-status", connState);
      return [] as T;
    default:
      return undefined as T;
  }
}
