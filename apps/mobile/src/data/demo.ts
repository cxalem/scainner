// TEMPORARY preview mode (owner request, 2026-08-21): walk the app's
// screens without signing in. Without a session the cloud returns zero
// rows by design (RLS), so a plain auth bypass would show only empty
// states — instead these fixtures stand in. Remove (or keep as an
// explicit demo entry) once email codes flow via custom SMTP.
//
// The fixtures are brand-neutral: VINs are synthetic, built on three
// different manufacturer prefixes, and no make/model is asserted.
import type { ScanEvent, SensorStats, VehicleListItem } from "./queries";

let enabled = false;
export const isDemo = () => enabled;
export const setDemo = (v: boolean) => {
  enabled = v;
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

// source: packages/uds-map/data/uds-map.json brands[].wmi[0] (first three
// brands with documented modules, pack order). Metro cannot bundle a JSON
// file from outside the app root, hence the copied prefixes.
const DEMO_WMIS = ["VF3", "W0V", "WVW"];

const demoVin = (wmi: string, n: number) => `${wmi}EXAMPLE`.padEnd(16, "0") + String(n);

export const DEMO_VEHICLES: VehicleListItem[] = DEMO_WMIS.map((wmi, i) => ({
  id: `demo-${i + 1}`,
  vin: demoVin(wmi, i + 1),
  displayName: `Demo vehicle ${i + 1}`,
  make: null,
  model: null,
  year: null,
  connectionCount: [47, 3, 12][i],
}));

const STATS: Record<string, SensorStats[]> = {
  "demo-1": [
    { key: "coolant", latest: 89, latestTs: hoursAgo(1), min: 18, avg: 76.4, max: 97, samples: 2841 },
    { key: "voltage", latest: 14.2, latestTs: hoursAgo(1), min: 11.9, avg: 14.0, max: 14.6, samples: 188 },
    { key: "rpm", latest: 812, latestTs: hoursAgo(1), min: 0, avg: 1642, max: 4180, samples: 2841 },
    { key: "speed", latest: 0, latestTs: hoursAgo(1), min: 0, avg: 38, max: 121, samples: 2841 },
  ],
  "demo-2": [
    { key: "coolant", latest: 79, latestTs: hoursAgo(3), min: 41, avg: 71.2, max: 79, samples: 214 },
    { key: "voltage", latest: 12.4, latestTs: hoursAgo(3), min: 12.1, avg: 12.5, max: 13.9, samples: 12 },
    { key: "rpm", latest: 781, latestTs: hoursAgo(3), min: 0, avg: 902, max: 2350, samples: 214 },
    { key: "speed", latest: 0, latestTs: hoursAgo(3), min: 0, avg: 4, max: 36, samples: 214 },
  ],
  "demo-3": [
    { key: "coolant", latest: 84, latestTs: hoursAgo(20), min: 22, avg: 74.0, max: 93, samples: 960 },
    { key: "voltage", latest: 13.8, latestTs: hoursAgo(20), min: 12.0, avg: 13.9, max: 14.5, samples: 64 },
    { key: "rpm", latest: 0, latestTs: hoursAgo(20), min: 0, avg: 1410, max: 3620, samples: 960 },
    { key: "speed", latest: 0, latestTs: hoursAgo(20), min: 0, avg: 29, max: 104, samples: 960 },
  ],
};

const SCANS: Record<string, ScanEvent[]> = {
  "demo-1": [
    { id: "demo-scan-1a", ts: hoursAgo(2), milOn: false, voltage: 14.1, codes: [] },
    { id: "demo-scan-1b", ts: hoursAgo(50), milOn: false, voltage: 13.9, codes: [] },
  ],
  "demo-2": [
    { id: "demo-scan-2a", ts: hoursAgo(4), milOn: true, voltage: 12.3, codes: [{ code: "P0204", status: "stored" }] },
    {
      id: "demo-scan-2b",
      ts: hoursAgo(28),
      milOn: true,
      voltage: 12.2,
      codes: [
        { code: "P0204", status: "stored" },
        { code: "P0402", status: "pending" },
      ],
    },
  ],
  "demo-3": [{ id: "demo-scan-3a", ts: hoursAgo(21), milOn: false, voltage: 13.7, codes: [{ code: "P0301", status: "pending" }] }],
};

export const demoStats = (vehicleId: string): SensorStats[] => STATS[vehicleId] ?? STATS["demo-1"];

export const demoScans = (vehicleId: string): ScanEvent[] => SCANS[vehicleId] ?? SCANS["demo-1"];
