// TEMPORARY preview mode (owner request, 2026-08-21): walk the app's
// screens without signing in. Without a session the cloud returns zero
// rows by design (RLS), so a plain auth bypass would show only empty
// states — instead these fixtures stand in, modeled on the two real test
// vehicles from the night this app was built. Remove (or keep as an
// explicit demo entry) once email codes flow via custom SMTP.
import type { ScanEvent, SensorStats, VehicleListItem } from "./queries";

let enabled = false;
export const isDemo = () => enabled;
export const setDemo = (v: boolean) => {
  enabled = v;
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export const DEMO_VEHICLES: VehicleListItem[] = [
  {
    id: "demo-citroen",
    vin: "VR7BAHNSANE014974",
    displayName: null,
    make: "Citroën",
    model: "C4 III",
    year: 2023,
    connectionCount: 47,
  },
  {
    id: "demo-peugeot",
    vin: null,
    displayName: "Yuli Peugeot",
    make: null,
    model: null,
    year: null,
    connectionCount: 3,
  },
];

const CITROEN_STATS: SensorStats[] = [
  { key: "coolant", latest: 89, latestTs: hoursAgo(1), min: 18, avg: 76.4, max: 97, samples: 2841 },
  { key: "voltage", latest: 14.2, latestTs: hoursAgo(1), min: 11.9, avg: 14.0, max: 14.6, samples: 188 },
  { key: "rpm", latest: 812, latestTs: hoursAgo(1), min: 0, avg: 1642, max: 4180, samples: 2841 },
  { key: "speed", latest: 0, latestTs: hoursAgo(1), min: 0, avg: 38, max: 121, samples: 2841 },
];

const PEUGEOT_STATS: SensorStats[] = [
  { key: "coolant", latest: 79, latestTs: hoursAgo(3), min: 41, avg: 71.2, max: 79, samples: 214 },
  { key: "voltage", latest: 12.4, latestTs: hoursAgo(3), min: 12.1, avg: 12.5, max: 13.9, samples: 12 },
  { key: "rpm", latest: 781, latestTs: hoursAgo(3), min: 0, avg: 902, max: 2350, samples: 214 },
  { key: "speed", latest: 0, latestTs: hoursAgo(3), min: 0, avg: 4, max: 36, samples: 214 },
];

const CITROEN_SCANS: ScanEvent[] = [
  { id: "demo-scan-c1", ts: hoursAgo(2), milOn: false, voltage: 14.1, codes: [] },
  { id: "demo-scan-c2", ts: hoursAgo(50), milOn: false, voltage: 13.9, codes: [] },
];

const PEUGEOT_SCANS: ScanEvent[] = [
  {
    id: "demo-scan-p1",
    ts: hoursAgo(4),
    milOn: true,
    voltage: 12.3,
    codes: [{ code: "P0204", status: "stored" }],
  },
  {
    id: "demo-scan-p2",
    ts: hoursAgo(28),
    milOn: true,
    voltage: 12.2,
    codes: [
      { code: "P0204", status: "stored" },
      { code: "P0402", status: "pending" },
    ],
  },
];

export const demoStats = (vehicleId: string): SensorStats[] =>
  vehicleId === "demo-peugeot" ? PEUGEOT_STATS : CITROEN_STATS;

export const demoScans = (vehicleId: string): ScanEvent[] =>
  vehicleId === "demo-peugeot" ? PEUGEOT_SCANS : CITROEN_SCANS;
