// Mirrors the Rust test suite in apps/desktop/src-tauri/src/elm/uds_map.rs
// — same behavior must hold in both implementations, since they read the
// same data file and must never silently drift apart.
//
// Tests are the one place brand ids may appear in this package's source:
// they pin the shape of specific pack entries, and the pack lint skips
// *.test.ts for that reason.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCoverage } from "../scripts/coverage.ts";
import { renderWmiTable, WMI_TABLE_PATH } from "../scripts/wmi-table.ts";
import { headingSlug, lintPack, researchAnchors } from "../scripts/lint.ts";
import { brandTokens, PKG_DIR } from "../scripts/pack.ts";
import {
  addressesToProbe,
  bandsForVin,
  brandForVin,
  can11,
  decodeKnownDid,
  decodeString,
  decodeValue,
  decodesForDid,
  deriveRoute,
  ecuFamilies,
  extendedModulesForVin,
  familyForHardwareRef,
  gatewayBehaviourForVin,
  getMap,
  hex16,
  hexAny,
  identDids,
  identityBlockForVin,
  knownDid,
  knownDidUnscoped,
  nameDids,
  overlayPacks,
  platformForVin,
  primaryDecode,
  profiledLevelForVin,
  readServiceForDid,
  readServiceForModule,
  resolveReadService,
  responseAddr,
  routeForModule,
} from "./index.js";
import type { Decode, KnownDid } from "./types.js";

const CITROEN_VIN = "VR7EXAMPLE0000001"; // a synthetic example VIN (PSA WMI prefix)

/** A synthetic VIN for a brand id: its first WMI plus filler. */
function vinFor(brandId: string, vds = "EXAMPLE"): string {
  const brand = getMap().brands.find((b) => b.id === brandId);
  if (!brand) throw new Error(`no brand ${brandId}`);
  return `${brand.wmi[0]}${vds.padEnd(7, "0").slice(0, 7)}0000000`;
}

describe("getMap", () => {
  it("parses and has content", () => {
    const m = getMap();
    expect(m.version).toBeGreaterThanOrEqual(9);
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

  it("round-trips: the file parses, serialises and parses again to the same document", () => {
    const raw = readFileSync(join(PKG_DIR, "data", "uds-map.json"), "utf-8");
    const once = JSON.parse(raw);
    expect(JSON.parse(JSON.stringify(once))).toEqual(once);
    expect(JSON.parse(JSON.stringify(getMap()))).toEqual(once);
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

  it("the F4xx mode-01 mirror band is low everywhere and sweeps last on its brands (v9)", () => {
    for (const b of getMap().brands) {
      const mirror = (b.did_bands ?? []).find((d) => d.from.toUpperCase() === "F400" && d.to.toUpperCase() === "F4FF");
      if (!mirror) continue;
      expect(mirror.confidence, `${b.id}: F4xx must be low`).toBe("low");
      const bands = bandsForVin(vinFor(b.id));
      const pos = bands.findIndex(([f]) => f === 0xf400);
      const lastNonLow = (b.did_bands ?? []).filter((d) => d.confidence !== "low").length;
      expect(pos).toBeGreaterThanOrEqual(Math.min(lastNonLow, bands.length - 1));
    }
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
    // The target-byte policy is conventional-only until Phase 2 implements
    // target iteration; it must not silently enable 29-bit enumeration.
    const targetByte = getMap().brands.find((b) => b.scan_policy === "conventional_11bit_and_target_byte_11bit");
    expect(targetByte).toBeDefined();
    const probes = addressesToProbe(vinFor(targetByte!.id));
    expect(probes.some((c) => c.source === "conventional_11bit")).toBe(true);
    expect(probes.some((c) => c.source === "normal_fixed_29bit")).toBe(false);
  });
});

describe("extendedModulesForVin", () => {
  it("counts documented 29-bit modules without crashing", () => {
    const gm = getMap().brands.find((b) => b.id === "gm");
    if (gm && gm.wmi.length > 0) {
      const vin = gm.wmi[0] + "00000000000000";
      expect(extendedModulesForVin(vin)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("knownDid / decodeKnownDid", () => {
  it("finds the verified battery-voltage DID on the engine module", () => {
    // Corrected during research: D422 is battery VOLTAGE, not state of
    // charge — proven by this project's own live correlation against PID
    // 0142. See RESEARCH.md.
    const k = knownDid(CITROEN_VIN, 0xd422, { req: 0x6a8, resp: 0x688 });
    expect(k).toBeDefined();
    expect(k!.label.toLowerCase()).toContain("battery");
    expect(k!.unit).toBe("V");
  });

  it("does not apply a DID meaning to a different module", () => {
    expect(knownDid(CITROEN_VIN, 0xd410, { req: 0x6b4, resp: 0x694 })).toBeDefined();
    expect(knownDid(CITROEN_VIN, 0xd410, { req: 0x6a8, resp: 0x688 })).toBeUndefined();
    expect(knownDid(CITROEN_VIN, 0xd410, { req: 0x6ad, resp: 0x68d })).toBeUndefined();
  });

  it("v9: no unscoped fallback — an unbound entry never labels a module's answer", () => {
    const unbound = getMap()
      .brands.flatMap((b) => (b.known_dids ?? []).filter((k) => k.binding === "unknown").map((k) => ({ brand: b, k })))
      .at(0);
    expect(unbound).toBeDefined();
    const vin = vinFor(unbound!.brand.id);
    const did = hex16(unbound!.k.did)!;
    for (const m of unbound!.brand.modules ?? []) {
      expect(knownDid(vin, did, { req: hexAny(m.req)!, resp: hexAny(m.resp)! })).toBeUndefined();
    }
    expect(knownDidUnscoped(vin, did)?.did).toBe(unbound!.k.did);
  });

  it("looks into overlay packs for module-scoped entries", () => {
    expect(overlayPacks().length).toBeGreaterThanOrEqual(1);
    const k = knownDid(CITROEN_VIN, 0x013c, { req: 0x18dac7f1, resp: 0x18daf1c7 });
    expect(k?.unit).toBe("bar");
    expect(decodeKnownDid(k!, [0x08, 0xca, 0x1e])).toBeCloseTo(2.25, 3);
    // The tyre temperature previously omitted from the overlay is the
    // second decode of the same payload (raw - 50 C).
    const decodes = decodesForDid(CITROEN_VIN, 0x18dac7f1, 0x18daf1c7, 0x013c);
    expect(decodes).toHaveLength(2);
    expect(decodeValue(decodes[1], [0x08, 0xca, 0x1e])).toBe(-20);
  });

  it("decodes a KnownDid's raw bytes when the map has a full formula", () => {
    const k = knownDid(CITROEN_VIN, 0xd422, { req: 0x6a8, resp: 0x688 })!;
    const decoded = decodeKnownDid(k, [0x05, 0x14]);
    expect(decoded).toBeCloseTo(0x0514 * 0.01, 6);
  });

  it("returns undefined when the map only documents the address, not the formula", () => {
    const k: KnownDid = { did: "0000", label: "no formula" };
    expect(decodeKnownDid(k, [1, 2, 3])).toBeUndefined();
    expect(primaryDecode(k)).toBeUndefined();
  });

  it("the legacy scalar fields mirror decodes[0] on every entry (lint invariant)", () => {
    for (const b of getMap().brands) {
      for (const k of b.known_dids ?? []) {
        const first = k.decodes?.[0];
        if (first) {
          expect([k.offset, k.len, k.scale, k.bias], `${b.id} ${k.did}`).toEqual([first.offset, first.len, first.scale, first.bias]);
        } else {
          expect(k.offset == null || k.len == null || k.scale == null || k.bias == null, `${b.id} ${k.did}`).toBe(true);
        }
      }
    }
  });
});

describe("decodeValue (v9 encodings)", () => {
  const base: Decode = { offset: 0, len: 2, signed: false, encoding: "be", scale: 1, bias: 0, unit: "", quantity: "raw", label: "t" };

  it("big-endian, little-endian, signed and offset-binary", () => {
    expect(decodeValue(base, [0x01, 0x02])).toBe(0x0102);
    expect(decodeValue({ ...base, encoding: "le" }, [0x01, 0x02])).toBe(0x0201);
    expect(decodeValue({ ...base, signed: true }, [0xff, 0xfe])).toBe(-2);
    expect(decodeValue({ ...base, len: 1, signed: true }, [0x80])).toBe(-128);
    expect(decodeValue({ ...base, len: 8, signed: true }, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe])).toBe(-2);
    expect(decodeValue({ ...base, encoding: "le", len: 8, signed: true }, [0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])).toBe(-2);
    expect(decodeValue({ ...base, scale: 0.1, bias: -3276.8 }, [0x80, 0x00])).toBeCloseTo(0, 6);
  });

  it("bit fields count from the least significant bit of the byte group", () => {
    const flags: Decode = { ...base, len: 1, encoding: "bitfield", bit_offset: 3, bit_len: 1 };
    expect(decodeValue(flags, [0b0000_1000])).toBe(1);
    expect(decodeValue(flags, [0b1111_0111])).toBe(0);
    const nibble: Decode = { ...base, len: 1, encoding: "bitfield", bit_offset: 4, bit_len: 4 };
    expect(decodeValue(nibble, [0xa5])).toBe(0xa);
    const signed64: Decode = { ...base, len: 8, signed: true, encoding: "bitfield", bit_offset: 0, bit_len: 64 };
    expect(decodeValue(signed64, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe])).toBe(-2);
  });

  it("packed BCD and ASCII", () => {
    expect(decodeValue({ ...base, encoding: "bcd", len: 3 }, [0x12, 0x34, 0x56])).toBe(123456);
    expect(decodeValue({ ...base, encoding: "bcd", len: 1 }, [0xff])).toBeUndefined();
    expect(decodeString({ ...base, encoding: "ascii", len: 0 }, [0x41, 0x42, 0x00, 0x43])).toBe("ABC");
  });

  it("refuses payloads shorter than the decode", () => {
    expect(decodeValue(base, [0x01])).toBeUndefined();
  });

  it("multi-value DIDs expose every value (wheel speeds, battery block)", () => {
    const multi = getMap()
      .brands.flatMap((b) => (b.known_dids ?? []).filter((k) => (k.decodes ?? []).length >= 4 && k.modules?.length).map((k) => ({ b, k })));
    expect(multi.length).toBeGreaterThanOrEqual(2);
    for (const { b, k } of multi) {
      const m = k.modules![0];
      const decodes = decodesForDid(vinFor(b.id), hexAny(m.req)!, hexAny(m.resp)!, hex16(k.did)!);
      expect(decodes.length).toBe(k.decodes!.length);
      const bytes = new Array(64).fill(0x10);
      for (const d of decodes) if (d.encoding !== "ascii") expect(decodeValue(d, bytes)).toBeDefined();
    }
  });
});

describe("v9 accessors (the Phase 2 contract)", () => {
  it("routeForModule: explicit route from data, derived otherwise, for two different brands", () => {
    const targetByte = getMap().brands.find((b) => (b.modules ?? []).some((m) => m.route?.target_byte && m.route.protocol === "can11_500"))!;
    const tbModule = targetByte.modules!.find((m) => m.route?.target_byte)!;
    const r1 = routeForModule(vinFor(targetByte.id), hexAny(tbModule.req)!, hexAny(tbModule.resp)!);
    expect(r1.protocol).toBe("can11_500");
    expect(r1.target_byte).toBe(tbModule.route!.target_byte);
    expect(r1.address_extension).toBe(tbModule.route!.address_extension);

    const nf = getMap().brands.find((b) => (b.modules ?? []).some((m) => m.route?.protocol === "can29_normal_fixed"))!;
    const nfModule = nf.modules!.find((m) => m.route?.protocol === "can29_normal_fixed")!;
    const r2 = routeForModule(vinFor(nf.id), hexAny(nfModule.req)!, hexAny(nfModule.resp)!);
    expect(r2.protocol).toBe("can29_normal_fixed");
    expect(r2.target_byte).toBe(nfModule.req.slice(4, 6).toUpperCase());

    // Undocumented pairs derive: conventional 11-bit or custom 29-bit.
    expect(routeForModule(undefined, 0x7e0, 0x7e8)).toEqual({ protocol: "can11_500", req: "7E0", resp: "7E8" });
    expect(deriveRoute(0x14dacbf1, 0x142af1cb).protocol).toBe("can29_custom");
    expect(deriveRoute(0x18da10f1, 0x18daf110)).toEqual({ protocol: "can29_normal_fixed", req: "18DA10F1", resp: "18DAF110", target_byte: "10" });
  });

  it("identityBlockForVin: ISO block for every brand, vendor layouts where sourced", () => {
    const iso = getMap().standard.identity_block!;
    expect(iso.dids.map((d) => d.did)).toContain("F187");
    for (const b of getMap().brands) {
      const block = identityBlockForVin(vinFor(b.id));
      for (const d of iso.dids) expect(block.dids.some((x) => x.did === d.did), `${b.id} lacks ISO ${d.did}`).toBe(true);
      expect(block.source.url.length).toBeGreaterThan(0);
    }
    const bcd = getMap().brands.filter((b) => b.identity_block?.dids.some((d) => d.layout === "bcd_part_refs"));
    expect(bcd.length).toBeGreaterThanOrEqual(1);
    const block = identityBlockForVin(vinFor(bcd[0].id));
    const part = block.dids.find((d) => d.layout === "bcd_part_refs" && d.field === "part")!;
    expect(part.offset).toBe(0);
    expect(part.len).toBe(5);
    const sw = block.dids.find((d) => d.layout === "bcd_part_refs" && d.field === "software")!;
    expect([sw.offset, sw.len, sw.prefix, sw.suffix]).toEqual([21, 3, "96", "80"]);
    expect(identityBlockForVin("ZZZ00000000000000")).toEqual(iso);
  });

  it("readServiceForModule: module override, brand default, standard default", () => {
    const withOverride = getMap().brands.find((b) => (b.modules ?? []).some((m) => m.read_service === "21"))!;
    const m21 = withOverride.modules!.find((m) => m.read_service === "21")!;
    const m22 = withOverride.modules!.find((m) => !m.read_service)!;
    const vin = vinFor(withOverride.id);
    expect(readServiceForModule(vin, hexAny(m21.req)!, hexAny(m21.resp)!)).toBe("21");
    expect(readServiceForModule(vin, hexAny(m22.req)!, hexAny(m22.resp)!)).toBe("22");
    expect(readServiceForModule("ZZZ00000000000000", 0x7e0, 0x7e8)).toBe("22");
    // No module carries a 1A override: 1A is a per-record service (review fix 3).
    for (const b of getMap().brands) for (const m of b.modules ?? []) expect(m.read_service, `${b.id} ${m.req}`).not.toBe("1A");
  });

  it("readServiceForDid: DID > module > platform > brand > standard", () => {
    expect(resolveReadService({ did: "1A", module: "21", platform: "22", brand: "22", standard: "22" })).toBe("1A");
    expect(resolveReadService({ module: "21", platform: "22", brand: "22" })).toBe("21");
    expect(resolveReadService({ platform: "21", brand: "22" })).toBe("21");
    expect(resolveReadService({ brand: "21", standard: "22" })).toBe("21");
    expect(resolveReadService({ standard: "21" })).toBe("21");
    expect(resolveReadService({})).toBe("22");
    // A DID-level override exists in data (a KWP identification record).
    const withDid = getMap().brands.find((b) => (b.known_dids ?? []).some((k) => k.read_service))!;
    const k = withDid.known_dids!.find((k) => k.read_service)!;
    expect(k.read_service).toBe("1A");
    if (k.modules?.length) {
      expect(readServiceForDid(vinFor(withDid.id), hexAny(k.modules[0].req)!, hexAny(k.modules[0].resp)!, hex16(k.did)!)).toBe("1A");
    }
    // Unbound entries never influence a module's service.
    for (const m of withDid.modules ?? []) {
      const svc = readServiceForDid(vinFor(withDid.id), hexAny(m.req)!, hexAny(m.resp)!, hex16(k.did)!);
      expect(svc).toBe(readServiceForModule(vinFor(withDid.id), hexAny(m.req)!, hexAny(m.resp)!));
    }
    // A module-level override flows through the DID accessor.
    const with21 = getMap().brands.find((b) => (b.modules ?? []).some((m) => m.read_service === "21"))!;
    const m21 = with21.modules!.find((m) => m.read_service === "21")!;
    expect(readServiceForDid(vinFor(with21.id), hexAny(m21.req)!, hexAny(m21.resp)!, 0x0001)).toBe("21");
    // Platform read services are consulted only through a VIN-selectable platform.
    const patterned = getMap().brands.find((b) => (b.platforms ?? []).some((p) => p.vds_pattern && p.read_service))!;
    const p = patterned.platforms!.find((p) => p.vds_pattern && p.read_service)!;
    const literal = p.vds_pattern!.replace(/^\^/, "").replace(/\[([^\]])[^\]]*\]/g, "$1");
    expect(readServiceForModule(vinFor(patterned.id, literal), 0x0001, 0x0002)).toBe(p.read_service);
  });

  it("decodesForDid: module-scoped, empty for other modules and unknown bindings", () => {
    expect(decodesForDid(CITROEN_VIN, 0x6ad, 0x68d, 0xd41f)[0]).toMatchObject({ offset: 0, len: 2, scale: 0.1, bias: -1250 });
    expect(decodesForDid(CITROEN_VIN, 0x6a8, 0x688, 0xd41f)).toEqual([]);
    const other = getMap().brands.find((b) => b.id !== "psa" && (b.known_dids ?? []).some((k) => k.modules?.length && (k.decodes ?? []).some((d) => d.signed)))!;
    const signed = other.known_dids!.find((k) => k.modules?.length && (k.decodes ?? []).some((d) => d.signed))!;
    const decodes = decodesForDid(vinFor(other.id), hexAny(signed.modules![0].req)!, hexAny(signed.modules![0].resp)!, hex16(signed.did)!);
    expect(decodes.some((d) => d.signed)).toBe(true);
  });

  it("profiledLevelForVin / gatewayBehaviourForVin are data, with an honest default", () => {
    expect(profiledLevelForVin(CITROEN_VIN)).toBe("decodes_verified");
    expect(profiledLevelForVin("ZZZ00000000000000")).toBeUndefined();
    const filtered = getMap().brands.find((b) => b.gateway_behaviour?.silence_means === "filtered")!;
    expect(gatewayBehaviourForVin(vinFor(filtered.id)).silence_means).toBe("filtered");
    const blocked = getMap().brands.find((b) => b.gateway_behaviour?.writes_blocked)!;
    expect(gatewayBehaviourForVin(vinFor(blocked.id)).writes_blocked).toBe(true);
    expect(gatewayBehaviourForVin("ZZZ00000000000000")).toEqual({ silence_means: "unknown", writes_blocked: false });
    for (const b of getMap().brands) expect(profiledLevelForVin(vinFor(b.id)), b.id).toBeDefined();
  });

  it("platformForVin: VDS regex on VIN 4-10, only where a pattern is sourced, on two brands", () => {
    const patterned = getMap().brands.filter((b) => (b.platforms ?? []).some((p) => p.vds_pattern));
    expect(patterned.length).toBeGreaterThanOrEqual(2);
    for (const b of patterned.slice(0, 3)) {
      const p = b.platforms!.find((p) => p.vds_pattern)!;
      // Build a VDS that matches: the literal characters of a "^ABC" pattern,
      // the first alternative of a "^[XY]" class, and the first branch of a
      // "^(ABC|DEF)" alternation.
      const literal = p
        .vds_pattern!.replace(/^\^/, "")
        .replace(/\(([^)|]*)[^)]*\)/g, "$1")
        .replace(/\[([^\]])[^\]]*\]/g, "$1");
      const vin = vinFor(b.id, literal);
      expect(platformForVin(vin)?.key, `${b.id} ${p.vds_pattern}`).toBe(p.key);
      expect(platformForVin(vinFor(b.id, "ZZZZZZZ"))?.key).not.toBe(p.key);
    }
    expect(platformForVin("ZZZ00000000000000")).toBeUndefined();
    expect(platformForVin("VR7")).toBeUndefined();
  });

  it("selects the reviewed European Kona OS descriptor without selecting Kona EV", () => {
    expect(platformForVin(vinFor("hyundai_kia", "K2811ZZ"))?.key).toBe("hyundai_kona_os");
    expect(platformForVin(vinFor("hyundai_kia", "K281GZZ"))?.key).not.toBe("hyundai_kona_os");
    expect(platformForVin(vinFor("hyundai_kia", "K281HZZ"))?.key).not.toBe("hyundai_kona_os");
  });

  it("every brand declares read services, identity, platforms[] and sources[] (shape)", () => {
    for (const b of getMap().brands) {
      expect(Array.isArray(b.platforms), b.id).toBe(true);
      expect(Array.isArray(b.sources), b.id).toBe(true);
      expect(b.identity_block?.dids.length, b.id).toBeGreaterThan(0);
      for (const p of b.platforms ?? []) {
        expect(p.years).toHaveLength(2);
        expect(p.source.url.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("ecu_families (v8/v9)", () => {
  it("parses, and every part reference is a ten-digit number", () => {
    const families = ecuFamilies();
    expect(families.length).toBeGreaterThanOrEqual(3);
    for (const f of families) {
      expect(f.id).toMatch(/^[a-z0-9_]+$/);
      expect(f.source?.type).toBe("project_capture");
      for (const ref of [...f.hardware_refs, ...f.software_refs]) {
        expect(ref, `${f.id}: bad ref ${ref}`).toMatch(/^\d{10}$/);
      }
      for (const m of f.modules_seen_on) {
        expect(hexAny(m.req), `${f.id}: bad req ${m.req}`).toBeDefined();
        expect(hexAny(m.resp), `${f.id}: bad resp ${m.resp}`).toBeDefined();
      }
      for (const d of f.decodes) {
        expect(hex16(d.did), `${f.id}: bad did ${d.did}`).toBeDefined();
        expect(d.len).toBeGreaterThan(0);
        expect(d.evidence.length).toBeGreaterThan(0);
        expect(d.quantity, `${f.id} ${d.did}: quantity`).toBeTruthy();
        if (d.knowledge_state === "locally_confirmed") expect(d.vehicles_confirmed).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("joins the ABS by part reference to the family with twelve decodes", () => {
    const abs = familyForHardwareRef("9846124980");
    expect(abs?.id).toBe("cont_esp_mk100_psa");
    expect(abs?.decodes).toHaveLength(12);
    expect(familyForHardwareRef("9844551780")?.decodes).toHaveLength(4);
    expect(familyForHardwareRef("0000000000")).toBeUndefined();
  });
});

describe("pack lints and coverage (P1.6)", () => {
  it("the shipped pack passes every lint", () => {
    expect(lintPack()).toEqual([]);
  });

  it("every RESEARCH.md anchor cited by the pack resolves to a heading", () => {
    expect(headingSlug("### 3.3 Not every brand's data is behind service `0x22`".replace(/^#+\s*/, ""))).toBe("33-not-every-brands-data-is-behind-service-0x22");
    expect(headingSlug("PSA / Stellantis Europe — **highest confidence in the file**")).toBe("psa--stellantis-europe--highest-confidence-in-the-file");
    const anchors = researchAnchors();
    expect(anchors.has("ford")).toBe(true);
    const raw = readFileSync(join(PKG_DIR, "data", "uds-map.json"), "utf-8");
    const cited = new Set([...raw.matchAll(/RESEARCH\.md#([^"]+)"/g)].map((m) => m[1]));
    expect(cited.size).toBeGreaterThan(5);
    for (const a of cited) expect(anchors.has(a), `#${a}`).toBe(true);
  });

  it("brand tokens come from the data and include every brand id", () => {
    const tokens = brandTokens(getMap());
    for (const b of getMap().brands) expect(tokens).toContain(b.id);
  });

  it("COVERAGE.md is the generator's current output (run `pnpm coverage`)", () => {
    const committed = readFileSync(join(PKG_DIR, "COVERAGE.md"), "utf-8");
    expect(committed).toBe(renderCoverage());
  });

  it("the desktop WMI table is the generator's current output (run `pnpm wmi-table`)", () => {
    const committed = readFileSync(WMI_TABLE_PATH, "utf-8");
    expect(committed).toBe(renderWmiTable());
  });

  it("the desktop WMI table routes every pack WMI to its brand", () => {
    const table = JSON.parse(renderWmiTable()) as Record<string, { key: string; brand: string | null }>;
    const map = getMap();
    for (const b of map.brands) for (const w of b.wmi) expect(table[w]?.brand, w).toBeTruthy();
    expect(Object.keys(table).length).toBeGreaterThanOrEqual(map.brands.reduce((n, b) => n + b.wmi.length, 0) - 5);
  });

  it("coverage totals reflect the pack (snapshot of the numbers that matter)", () => {
    const md = renderCoverage();
    const totals = md.split("\n").find((l) => l.startsWith("| **total**"))!;
    const map = getMap();
    const dids = map.brands.reduce((n, b) => n + (b.known_dids ?? []).length, 0);
    const modules = map.brands.reduce((n, b) => n + (b.modules ?? []).length, 0);
    const wmi = map.brands.reduce((n, b) => n + b.wmi.length, 0);
    expect(totals).toContain(`| ${wmi} |`);
    expect(totals).toContain(`| ${modules} (`);
    expect(totals).toContain(`| ${dids} |`);
    expect(md).toContain("## Unknown bindings");
  });
});
