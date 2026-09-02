import { GAUGE_LABELS_ES, MONITOR_LABELS_ES } from "./gauges.es";
import type { Locale } from "@/i18n";

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

export function gaugeLabel(key: string, locale: Locale): string {
  if (locale === "es" && GAUGE_LABELS_ES[key]) return GAUGE_LABELS_ES[key];
  return GAUGES.find((g) => g.key === key)?.label ?? key;
}

export function monitorLabel(key: string, locale: Locale): string {
  if (locale === "es" && MONITOR_LABELS_ES[key]) return MONITOR_LABELS_ES[key];
  return MONITOR_LABELS[key] ?? key;
}

export function statLabel(key: string, locale: Locale): string {
  const gauge = GAUGES.find((g) => g.key === key);
  if (!gauge) return key === "voltage" ? (locale === "es" ? "Batería (V)" : "Battery (V)") : key;
  return `${gaugeLabel(key, locale)} (${gauge.unit})`;
}

export const RANGES = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
];

export const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
