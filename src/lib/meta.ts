// Shared types + sensor metadata used across views.

export type Live = Record<string, number>;
export type ConnStatus = { state: string; elm_version?: string | null; detail?: string | null };

export type DtcResult = {
  mil_on: boolean;
  dtc_count: number;
  stored: string[];
  pending: string[];
  permanent: string[];
  voltage?: number | null;
  freeze?: Record<string, unknown> | null;
};
export type DtcScanRow = DtcResult & { id: number; ts: string };
export type EcuInfo = { vin: string; protocol: string; elm_version: string };
export type HistoryPoint = { ts: string; value: number };
export type SensorReading = { pid: string; key: string; label: string; unit: string; value: number };

export type UdsModule = { key: string; label: string; req: string; resp: string; builtin: boolean };
export type UdsHit = { did: number; hex: string; ascii: string };
export type UdsProbe = {
  id: number;
  module: string;
  did: number;
  label: string;
  unit: string;
  offset: number;
  len: number;
  scale: number;
  bias: number;
  enabled: boolean;
};

export type KeyStat = { key: string; n: number; min: number; avg: number; max: number };
export type SessionRow = {
  id: number;
  started_at: string;
  ended_at: string | null;
  readings: number;
  max_speed: number | null;
  max_coolant: number | null;
  min_voltage: number | null;
  minutes: number;
};
export type Insights = {
  window_hours: number;
  engine_hours: number;
  fuel_lph_avg: number | null;
  speed_avg: number | null;
  l_per_100km: number | null;
  fuel_total_l: number | null;
  km_total: number | null;
  ltft_avg: number | null;
  coolant_max: number | null;
  coolant_reached_op: boolean;
  boost_max_kpa: number | null;
  baro_kpa: number | null;
  voltage_min: number | null;
  voltage_avg: number | null;
  fuel_price: number;
  fuel_level_pct: number | null;
};
export type CarReport = {
  vin: string;
  insights: Insights;
  session_count: number;
  engine_minutes: number;
  total_readings: number;
  first: string | null;
  last: string | null;
  scans_total: number;
  scans_clean: number;
  sessions: SessionRow[];
  stats_7d: KeyStat[];
  stats_all: KeyStat[];
  daily_voltage: { day: string; min: number; avg: number; max: number }[];
};

export const GAUGES: { key: string; label: string; unit: string; fmt?: (v: number) => string }[] = [
  { key: "rpm", label: "RPM", unit: "rpm", fmt: (v) => v.toFixed(0) },
  { key: "speed", label: "Speed", unit: "km/h", fmt: (v) => v.toFixed(0) },
  { key: "coolant", label: "Coolant", unit: "°C", fmt: (v) => v.toFixed(0) },
  { key: "voltage", label: "Battery", unit: "V", fmt: (v) => v.toFixed(1) },
  { key: "load", label: "Engine load", unit: "%", fmt: (v) => v.toFixed(0) },
  { key: "throttle", label: "Throttle", unit: "%", fmt: (v) => v.toFixed(0) },
  { key: "intake_temp", label: "Intake air", unit: "°C", fmt: (v) => v.toFixed(0) },
  { key: "map", label: "Manifold", unit: "kPa", fmt: (v) => v.toFixed(0) },
  { key: "stft", label: "Fuel trim (S)", unit: "%", fmt: (v) => v.toFixed(1) },
  { key: "ltft", label: "Fuel trim (L)", unit: "%", fmt: (v) => v.toFixed(1) },
  { key: "fuel_rate", label: "Fuel rate", unit: "L/h", fmt: (v) => v.toFixed(2) },
  { key: "fuel_level", label: "Fuel level", unit: "%", fmt: (v) => v.toFixed(0) },
];

export const MONITOR_LABELS: Record<string, string> = {
  misfire: "Misfire",
  fuel_system: "Fuel system",
  components: "Components",
  catalyst: "Catalyst",
  heated_catalyst: "Heated catalyst",
  evap: "EVAP system",
  secondary_air: "Secondary air",
  o2_sensor: "O2 sensors",
  o2_heater: "O2 heaters",
  egr_vvt: "EGR / VVT",
};

export const STAT_LABELS: Record<string, string> = Object.fromEntries([
  ...GAUGES.map((g) => [g.key, `${g.label} (${g.unit})`]),
  ["voltage", "Battery (V)"],
]);

export const RANGES = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
];

export const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

// ---------- pending-state phrase narration ----------
// Module-level constants (not inline arrays) so components can pass them
// straight to useCyclingLabel without retriggering its effect every render.
// No backend progress event for connect/all_sensors — these are timed
// phrases on the frontend, a deliberate scope cut (decisions-plan.md: "Keep
// the no-Rust non-goal").

export const CONNECT_PHRASES = ["Waking the dongle…", "Negotiating protocol…"] as const;

export const ALL_SENSORS_PHRASES = ["Interrogating ECU…", "Sweeping sensor PIDs…"] as const;
