// Mirrors the Rust test suite in apps/desktop/src-tauri/src/elm/uds_map.rs
// — same behavior must hold in both implementations, since they read the
// same data file and must never silently drift apart.
import { describe, expect, it } from "vitest";
import {
  addressesToProbe,
  bandsForVin,
  brandForVin,
  can11,
  decodeKnownDid,
  extendedModulesForVin,
  getMap,
  hex16,
  hexAny,
  identDids,
  knownDid,
  nameDids,
  responseAddr,
} from "./index.js";

const CITROEN_VIN = "VR7EXAMPLE0000001"; // a synthetic example VIN (PSA WMI prefix)

describe("getMap", () => {
  it("parses and has content", () => {
    const m = getMap();
    expect(m.version).toBeGreaterThanOrEqual(2);
    expect(m.brands.length).toBeGreaterThan(0);
    expect(m.standard.ident_dids.length).toBeGreaterThan(0);
  });

  it("covers the brands this map claims to", () => {
    const ids = getMap().brands.map((b) => b.id);
    for (const wanted of ["psa", "hyundai_kia", "vag", "seat", "cupra", "bmw", "renault", "ford", "toyota"]) {
      expect(ids).toContain(wanted);
    }
    expect(getMap().brands.length).toBeGreaterThanOrEqual(20);
  });

  it("every hex field in the shipped map parses (a typo must fail here, not on a real car)", () => {
    for (const b of getMap().brands) {
      for (const m of b.modules ?? []) {
        expect(hexAny(m.req), `${b.id}: bad req ${m.req}`).toBeDefined();
        expect(hexAny(m.resp), `${b.id}: bad resp ${m.resp}`).toBeDefined();
      }
      for (const d of b.did_bands ?? []) {
        const f = hex16(d.from);
        const t = hex16(d.to);
        expect(f, `${b.id}: bad band`).toBeDefined();
        expect(t, `${b.id}: bad band`).toBeDefined();
        expect(f! <= t!, `${b.id}: inverted band`).toBe(true);
      }
      for (const k of b.known_dids ?? []) {
        expect(hex16(k.did), `${b.id}: bad did ${k.did}`).toBeDefined();
        for (const m of k.modules ?? []) {
          expect(hexAny(m.req), `${b.id} ${k.did}: bad module req ${m.req}`).toBeDefined();
          expect(hexAny(m.resp), `${b.id} ${k.did}: bad module resp ${m.resp}`).toBeDefined();
        }
      }
    }
    expect(identDids().length).toBeGreaterThan(0);
    expect(nameDids().length).toBeGreaterThan(0);
  });
});

describe("hex parsing", () => {
  it("can11 rejects 29-bit extended addresses; hexAny accepts them", () => {
    expect(can11("14DACBF1")).toBeUndefined();
    expect(hexAny("14DACBF1")).toBe(0x14dacbf1);
    expect(can11("7E0")).toBe(0x7e0);
  });

  it("hex16 is NOT constrained to the 11-bit CAN range — DIDs need the full width", () => {
    expect(hex16("D422")).toBe(0xd422);
    expect(hex16("F190")).toBe(0xf190);
    expect(can11("D422")).toBeUndefined();
  });
});

describe("brandForVin / bandsForVin", () => {
  it("selects the right brand and narrows the sweep", () => {
    const psa = brandForVin(CITROEN_VIN);
    expect(psa?.id).toBe("psa");
    const narrowed = bandsForVin(CITROEN_VIN);
    const union = bandsForVin(undefined);
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThan(union.length);
  });

  it("falls back to every brand's bands for an unknown VIN, never to nothing", () => {
    expect(brandForVin("ZZZ00000000000000")).toBeUndefined();
    expect(bandsForVin("ZZZ00000000000000").length).toBeGreaterThan(0);
    expect(bandsForVin(undefined).length).toBeGreaterThan(0);
  });

  it("sweeps confirmed bands before low-confidence ones", () => {
    // A widely-cited PSA band (D0xx) returned zero hits on the real car;
    // it must not consume a scan before the productive D4xx does.
    const bands = bandsForVin(CITROEN_VIN);
    const d4 = bands.findIndex(([f]) => f === 0xd400);
    const d0 = bands.findIndex(([f]) => f === 0xd000);
    if (d4 !== -1 && d0 !== -1) expect(d4).toBeLessThan(d0);
  });
});

describe("addressesToProbe / responseAddr", () => {
  it("probes known brand modules before the blind sweep, with no duplicates", () => {
    const addrs = addressesToProbe(CITROEN_VIN);
    expect(addrs[0]?.name).toBeTruthy();
    const reqs = addrs.map((a) => a.req);
    expect(new Set(reqs).size).toBe(reqs.length);
  });

  it("PSA uses two response-offset rules, not one", () => {
    // Reconciles this project's own anchors: 6B4/694 is the 6xx rule
    // (-0x20), 752/652 is the 7xx rule (-0x100) — a single global offset
    // gets one of them wrong, which is exactly the bug this table
    // prevents. See RESEARCH.md for how this was verified.
    const psa = brandForVin(CITROEN_VIN);
    expect(responseAddr(psa, 0x6b4)).toBe(0x694);
    expect(responseAddr(psa, 0x752)).toBe(0x652);
  });

  it("falls back to the standard offset for an unrecognized brand", () => {
    expect(responseAddr(undefined, 0x7e0)).toBe(0x7e8);
  });

  it("every 11-bit sweep response stays in range", () => {
    for (const candidate of addressesToProbe(CITROEN_VIN).filter((entry) => entry.source === "conventional_11bit")) {
      expect(candidate.resp).toBeLessThanOrEqual(0x7ff);
    }
  });

  it("builds all physical normal-fixed 29-bit target pairs for an unknown VIN", () => {
    const extended = addressesToProbe(undefined).filter((candidate) => candidate.source === "normal_fixed_29bit");
    expect(extended).toHaveLength(253);
    for (const candidate of extended) {
      const target = (candidate.req >>> 8) & 0xff;
      expect(candidate.req).toBe(0x18da00f1 | (target << 8));
      expect(candidate.resp).toBe(0x18daf100 | target);
      expect([0xf1, 0xfe, 0xff]).not.toContain(target);
    }
  });

  it("honors data-driven brand scan policies", () => {
    expect(addressesToProbe("5YJEXAMPLE0000000")).toHaveLength(0);
    expect(addressesToProbe("JA3EXAMPLE0000000")).toHaveLength(0);
    const volvo = addressesToProbe("YV1EXAMPLE0000000");
    expect(volvo.length).toBeGreaterThan(0);
    expect(volvo.every((candidate) => candidate.req > 0x7ff)).toBe(true);
  });
});

describe("extendedModulesForVin", () => {
  it("counts documented 29-bit modules without crashing", () => {
    // GM ships 29-bit addresses (14DACBF1) — real data the map correctly
    // records; this must be countable, not silently dropped or fatal.
    const gm = getMap().brands.find((b) => b.id === "gm");
    if (gm && gm.wmi.length > 0) {
      const vin = gm.wmi[0] + "00000000000000";
      expect(extendedModulesForVin(vin)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("knownDid / decodeKnownDid", () => {
  it("finds the verified Citroën battery-voltage DID", () => {
    // Corrected during research: D422 is battery VOLTAGE, not state of
    // charge — proven by this project's own live correlation against PID
    // 0142. See RESEARCH.md.
    const k = knownDid(CITROEN_VIN, 0xd422);
    expect(k).toBeDefined();
    expect(k!.label.toLowerCase()).toContain("battery");
    expect(k!.unit).toBe("V");
  });

  it("does not apply a DID meaning to a different module", () => {
    expect(knownDid(CITROEN_VIN, 0xd410, { req: 0x6b4, resp: 0x694 })).toBeDefined();
    expect(knownDid(CITROEN_VIN, 0xd410, { req: 0x6a8, resp: 0x688 })).toBeUndefined();
    expect(knownDid(CITROEN_VIN, 0xd410, { req: 0x6ad, resp: 0x68d })).toBeUndefined();
  });

  it("decodes a KnownDid's raw bytes when the map has a full formula", () => {
    const k = knownDid(CITROEN_VIN, 0xd422)!;
    if (k.offset != null && k.len != null && k.scale != null && k.bias != null) {
      const decoded = decodeKnownDid(k, [0x05, 0x14]); // arbitrary 2-byte sample
      expect(decoded).toBeDefined();
      expect(Number.isFinite(decoded)).toBe(true);
    }
  });

  it("returns undefined when the map only documents the address, not the formula", () => {
    const k = { did: "0000", label: "no formula" };
    expect(decodeKnownDid(k, [1, 2, 3])).toBeUndefined();
  });
});
