// VIN → manufacturer, from the WMI (World Manufacturer Identifier — the
// VIN's first three characters, ISO 3780). This is a deliberately small,
// curated table of common European/global passenger-car WMIs, not an
// attempt at completeness: the UI needs a brand identity for the connected
// car, and an unknown WMI simply falls back to a generic badge. Add rows
// as unrecognized cars show up — `brandFromVin` logs nothing and never
// throws.
//
// `key` doubles as the 3D-emblem selector in VehicleScene (a brand with
// modeled emblem geometry renders it; anything else renders a nameplate
// badge with `name`).

export type BrandInfo = { key: string; name: string };

const WMI: Record<string, BrandInfo> = {
  // Stellantis (FR)
  VR7: { key: "citroen", name: "CITROËN" }, // Citroën post-2019 (the user's own C4 is VR7...)
  VF7: { key: "citroen", name: "CITROËN" },
  VR1: { key: "ds", name: "DS" },
  VR3: { key: "peugeot", name: "PEUGEOT" },
  VF3: { key: "peugeot", name: "PEUGEOT" },
  W0L: { key: "opel", name: "OPEL" },
  ZFA: { key: "fiat", name: "FIAT" },
  ZAR: { key: "alfa-romeo", name: "ALFA ROMEO" },
  // Renault group
  VF1: { key: "renault", name: "RENAULT" },
  UU1: { key: "dacia", name: "DACIA" },
  // VW group
  WVW: { key: "volkswagen", name: "VOLKSWAGEN" },
  WV1: { key: "volkswagen", name: "VOLKSWAGEN" },
  WV2: { key: "volkswagen", name: "VOLKSWAGEN" },
  WAU: { key: "audi", name: "AUDI" },
  TRU: { key: "audi", name: "AUDI" },
  VSS: { key: "seat", name: "SEAT" },
  TMB: { key: "skoda", name: "ŠKODA" },
  // BMW / Mercedes / Porsche
  WBA: { key: "bmw", name: "BMW" },
  WBS: { key: "bmw", name: "BMW" },
  WBY: { key: "bmw", name: "BMW" },
  WDB: { key: "mercedes", name: "MERCEDES-BENZ" },
  WDD: { key: "mercedes", name: "MERCEDES-BENZ" },
  W1K: { key: "mercedes", name: "MERCEDES-BENZ" },
  W1N: { key: "mercedes", name: "MERCEDES-BENZ" },
  WP0: { key: "porsche", name: "PORSCHE" },
  WP1: { key: "porsche", name: "PORSCHE" },
  // Asia
  JTD: { key: "toyota", name: "TOYOTA" },
  JTE: { key: "toyota", name: "TOYOTA" },
  SB1: { key: "toyota", name: "TOYOTA" },
  VNK: { key: "toyota", name: "TOYOTA" },
  JHM: { key: "honda", name: "HONDA" },
  SHH: { key: "honda", name: "HONDA" },
  JN1: { key: "nissan", name: "NISSAN" },
  SJN: { key: "nissan", name: "NISSAN" },
  VSK: { key: "nissan", name: "NISSAN" },
  JM1: { key: "mazda", name: "MAZDA" },
  JMZ: { key: "mazda", name: "MAZDA" },
  KMH: { key: "hyundai", name: "HYUNDAI" },
  TMA: { key: "hyundai", name: "HYUNDAI" },
  KNA: { key: "kia", name: "KIA" },
  KNE: { key: "kia", name: "KIA" },
  U5Y: { key: "kia", name: "KIA" },
  JSA: { key: "suzuki", name: "SUZUKI" },
  // Geely Group is a real gap: BYD/Chery/Geely are among Europe's
  // fastest-growing brands (Chery +306%, Geely Group +8.5% in H1 2026 per
  // best-selling-cars.com) and none had a WMI entry until this row. LB3 is
  // core Geely-badged models specifically (Coolray, Emgrand, Atlas Pro).
  // Deliberately not adding L6T: that prefix is shared group-wide across
  // Geely, Zeekr, and Geometry, so mapping it to "geely" would misattribute
  // a Zeekr as a Geely — a wrong badge is worse than no badge (see
  // docs/workflows/3d-logos/research.md section 5).
  LB3: { key: "geely", name: "GEELY" },
  // Others
  WF0: { key: "ford", name: "FORD" },
  VS6: { key: "ford", name: "FORD" },
  YV1: { key: "volvo", name: "VOLVO" },
  YV4: { key: "volvo", name: "VOLVO" },
  "5YJ": { key: "tesla", name: "TESLA" },
  XP7: { key: "tesla", name: "TESLA" },
  SAL: { key: "land-rover", name: "LAND ROVER" },
  SAJ: { key: "jaguar", name: "JAGUAR" },
  VXK: { key: "opel", name: "OPEL" },
};

export function brandFromVin(vin: string | null | undefined): BrandInfo | null {
  if (!vin || vin.length < 3) return null;
  return WMI[vin.slice(0, 3).toUpperCase()] ?? null;
}
