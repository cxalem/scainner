// Spanish labels for GAUGES/MONITOR_LABELS (gauges.ts) — same key-based
// lookup pattern as lib/dtc.ts's localizedSystem/etc: the English data
// stays the stable default, this is a parallel label map consulted only
// for display. Units (km/h, °C, %, kPa, L/h, V, rpm) are NOT translated —
// they're the same abbreviations in Spanish.
export const GAUGE_LABELS_ES: Record<string, string> = {
  rpm: "RPM",
  speed: "Velocidad",
  coolant: "Refrigerante",
  voltage: "Batería",
  load: "Carga del motor",
  throttle: "Acelerador",
  intake_temp: "Aire de admisión",
  map: "Colector (MAP)",
  stft: "Ajuste combustible (corto)",
  ltft: "Ajuste combustible (largo)",
  fuel_rate: "Consumo instantáneo",
  fuel_level: "Nivel de combustible",
};

export const MONITOR_LABELS_ES: Record<string, string> = {
  misfire: "Fallos de encendido",
  fuel_system: "Sistema de combustible",
  components: "Componentes",
  catalyst: "Catalizador",
  heated_catalyst: "Catalizador calefactado",
  evap: "Sistema EVAP",
  secondary_air: "Aire secundario",
  o2_sensor: "Sondas lambda",
  o2_heater: "Calefactores de sonda",
  egr_vvt: "EGR / VVT",
};
