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
  // JMZ removed 2026-08-21 (full-table audit,
  // docs/workflows/3d-logos/wmi-audit.md): no source found at all, not in
  // NHTSA's registry, not in Mazda's own 11-row NHTSA list, just an
  // unsourced AI-summary claim with no checkable page behind it. Same
  // principle as everywhere else in this file — a wrong badge is worse
  // than no badge, and this one was never actually confirmed to be right.
  KMH: { key: "hyundai", name: "HYUNDAI" },
  TMA: { key: "hyundai", name: "HYUNDAI" },
  KNA: { key: "kia", name: "KIA" },
  KNE: { key: "kia", name: "KIA" },
  U5Y: { key: "kia", name: "KIA" },
  // Was JSA until the audit above caught a real error, not just low
  // confidence: NHTSA confirms JSA is a motorcycle WMI (Suzuki Motor of
  // America, VehicleType Motorcycle, shared with Kawasaki), not a car
  // code. JS2 is Suzuki's actual passenger-car/truck code, NHTSA-confirmed
  // plain "SUZUKI."
  JS2: { key: "suzuki", name: "SUZUKI" },
  // Geely Group is a real gap: BYD/Chery/Geely are among Europe's
  // fastest-growing brands (Chery +306%, Geely Group +8.5% in H1 2026 per
  // best-selling-cars.com) and none had a WMI entry until this row. LB3 is
  // core Geely-badged models (Coolray, Emgrand, Atlas Pro) — that mapping
  // holds up across every source checked. The excluded-L6T reasoning
  // below is weaker than originally stated: the audit
  // (docs/workflows/3d-logos/wmi-audit.md) found Wikibooks directly
  // contradicts which sub-brands (Geometry, mainline Geely) sit on LB3 vs
  // L6T specifically — genuinely unresolved, not a settled split. Still
  // deliberately not adding L6T, since it's at least partly Zeekr's
  // (NHTSA-confirmed, Zeekr registered its own US entity under L6T in
  // Nov 2024) and the wrong-badge-worse-than-no-badge principle applies
  // regardless of exactly how the group's other prefixes shake out (see
  // docs/workflows/3d-logos/research.md section 5).
  LB3: { key: "geely", name: "GEELY" },
  // BYD: LGX confirmed against NHTSA's own WMI registry directly
  // (vpic.nhtsa.dot.gov/api/vehicles/GetWMIsForManufacturer/BYD), not just a
  // web search summary — high confidence. One low-quality source claimed
  // "LVV" for BYD while a separate one claimed the same "LVV" for Chery;
  // NHTSA settles the conflict for BYD specifically, LGX it is.
  LGX: { key: "byd", name: "BYD" },
  // Chery: LVV, corroborated by two independent secondary sources (not an
  // official registry hit like BYD above, since Chery doesn't sell in the
  // US and so isn't in NHTSA's database) — medium confidence, not the same
  // bar as LGX, flagged honestly rather than presented as equally certain.
  LVV: { key: "chery", name: "CHERY" },
  // Others
  WF0: { key: "ford", name: "FORD" },
  VS6: { key: "ford", name: "FORD" },
  YV1: { key: "volvo", name: "VOLVO" },
  YV4: { key: "volvo", name: "VOLVO" },
  "5YJ": { key: "tesla", name: "TESLA" },
  XP7: { key: "tesla", name: "TESLA" },
  SAL: { key: "land-rover", name: "LAND ROVER" },
  SAJ: { key: "jaguar", name: "JAGUAR" },
  // VXK removed 2026-08-21 (full-table audit,
  // docs/workflows/3d-logos/wmi-audit.md): two source lineages directly
  // contradict each other on what this code even is — one says
  // Opel/Vauxhall-shared (France-built Grandland), the other says
  // Vauxhall-specific with a separate code (VLG) for the shared cars.
  // Not a confidence gap, an unresolved conflict; W0L below already
  // covers real Opel cars correctly on its own.
};

export function brandFromVin(vin: string | null | undefined): BrandInfo | null {
  if (!vin || vin.length < 3) return null;
  return WMI[vin.slice(0, 3).toUpperCase()] ?? null;
}
