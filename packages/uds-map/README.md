# @scainner/uds-map

A queryable knowledge map of manufacturer-specific **UDS (ISO 14229)** diagnostic addresses and DID (Data Identifier) ranges — the data that lets a diagnostic tool find *more* than the standardized OBD2 PID set exposes: battery state, tire pressure, per-module identification, and hundreds of other manufacturer-specific values, keyed by VIN.

Extracted from [Scainner](https://github.com/cxalem/scainner), an open-source car-diagnostics app, where this exact file drives its one-button sensor auto-discovery engine.

**21 brands, 251 VIN (WMI) prefixes, 180 module address pairs (with routes and read services), 203 identified DIDs with 233 decodes**, identity blocks, platforms and gateway semantics per brand, plus 3 `ecu_families` carrying 16 decodes — every entry with a `confidence` level (`confirmed` / `high` / `medium` / `low`) and a `source` (`url`, `date`, `type`, `licence`). The exact per-brand numbers are generated from the pack into [`COVERAGE.md`](./COVERAGE.md) by `pnpm coverage` (CI fails when it is stale). See [`RESEARCH.md`](./RESEARCH.md) for full per-brand provenance, sources, and known gaps, and [`docs/uds/pack-schema-v9.md`](../../docs/uds/pack-schema-v9.md) for the schema.

## Read this before you use it

- **Read-only, and meant to stay that way.** This package answers "what address/DID should I try for this VIN" — it has no transport layer and never talks to a car. If you build something that *writes* to a vehicle using addresses from this map, that is entirely your own responsibility; several entries are `medium`/`low` confidence, meaning they are community-sourced or single-source and have not been independently reproduced.
- **No warranty, explicitly.** Car diagnostic protocols vary by model year, trim, and region even within one WMI prefix. Confirm anything safety- or cost-relevant against your own hardware before relying on it.
- **`confirmed`** means read on real hardware in the Scainner project itself (or reproduced byte-for-byte against an independent source). Everything else is sourced from public reverse-engineering work — see `RESEARCH.md`'s citations for each brand.
- **Node.js only** (reads its data file from disk with `node:fs`). Not bundled for the browser — this data is inherently about talking to a car's CAN bus, which needs a native/serial transport layer anyway.

## Install

```bash
npm install @scainner/uds-map
```

## Use

```ts
import { brandForVin, bandsForVin, addressesToProbe, knownDid, decodeKnownDid } from "@scainner/uds-map";

// Synthetic example VINs — one per brand family, so the examples below don't
// assume a single manufacturer's addressing.
const vin = "VR7EXAMPLE0000001";  // WMI prefix of one European brand (PSA)
const vin2 = "WVWEXAMPLE0000002"; // WMI prefix of another (VW Group)

brandForVin(vin);
// => { id: "psa", name: "PSA / Stellantis...", wmi: [...], modules: [...], ... }

bandsForVin(vin);
// => [[0xD400, 0xD4FF], [0xD600, 0xD6FF], ...] — confidence-ordered DID
//    neighborhoods worth sweeping for this brand, confirmed bands first

addressesToProbe(vin);
// => this brand's documented module addresses first, then the full
//    11-bit conventional range behind them, with each response address
//    derived using the brand's actual offset rule (see below)

const battery = knownDid(vin, 0xd422, { req: 0x6a8, resp: 0x688 }); // module-scoped: a DID means something on one ECU
// => { did: "D422", label: "Battery voltage...", unit: "V",
//      decodes: [{ offset: 0, len: 2, signed: false, encoding: "be", scale: 0.01, bias: 0, unit: "V", quantity: "voltage", ... }],
//      offset: 0, len: 2, scale: 0.01, bias: 0, confidence: "confirmed", source: { url, date, type, licence } }

decodeKnownDid(battery!, [0x05, 0x50]); // apply the primary decode to raw response bytes
// => 13.6

// v9: the per-module facts the discovery engine runs on
routeForModule(vin2, 0x7e0, 0x7e8);      // => { protocol: "can11_500", req: "7E0", resp: "7E8" } (generic OBD engine slot)
readServiceForModule(vin2, 0x7e0, 0x7e8); // => "22" (module override → brand default → "22")
identityBlockForVin(vin2);               // => ISO DIDs (F186/F187/F18A…) first, then vendor layouts (e.g. packed-BCD part references)
decodesForDid(vin, 0x6ad, 0x68d, 0xd41f); // => every value in that DID's payload on that module
platformForVin(vin2);                    // => a platform whose sourced VDS pattern matches VIN 4-10, or undefined
profiledLevelForVin(vin2);               // => "standard_only" | "routes_sourced" | "routes_verified" | "decodes_verified"
gatewayBehaviourForVin(vin2);            // => { silence_means: "absent" | "filtered" | "unknown", writes_blocked }
```

### Why `addressesToProbe` matters: response addresses are not `request + 8`

A naive UDS sweeper assumes a module's response address is always its request address plus a fixed offset. That's wrong for most brands: VW Group is `+0x6A` for its real modules (only `+0x08` on the generic OBD-passthrough block), GM is `+0x400`, FCA is `-0x280` — and PSA alone uses **two different rules** depending on which address block you're in. `responseAddr(brand, req)` (and `addressesToProbe`, which uses it) applies the correct per-block rule from the map instead of guessing. See `RESEARCH.md` section 3.1 for the full table and how it was verified.

## API

| Function | What it answers |
|---|---|
| `getMap()` | The full parsed map |
| `brandForVin(vin)` | Which brand this VIN belongs to, from its WMI prefix |
| `bandsForVin(vin)` | DID neighborhoods worth sweeping, confidence-ordered |
| `knownModulesForVin(vin)` | This brand's documented module addresses |
| `extendedModulesForVin(vin)` | Count of 29-bit-addressed modules an 11-bit-only sweeper can't reach |
| `responseAddr(brand, req)` | The correct response address for a request address, per this brand's rule |
| `addressesToProbe(vin)` | Known modules first, then the full conventional sweep, response addresses pre-derived |
| `identDids()` / `nameDids()` / `presenceProbeDid()` | The standardized (ISO 14229-1) identification DIDs — universal, not brand-specific |
| `knownDid(vin, did, module)` | A documented label + decodes for a DID on exactly that module (v9: no unscoped fallback; `knownDidUnscoped` for browsing) |
| `decodesForDid(vin, req, resp, did)` | Every value in a DID's payload on that module (multi-value, signed, bit fields, strings) |
| `decodeKnownDid(known, bytes)` / `decodeValue(decode, bytes)` / `decodeString(decode, bytes)` | Apply a decode to raw response bytes |
| `routeForModule(vin, req, resp)` | The route tuple (protocol, ids, target byte, address extension, gateway), explicit or derived |
| `readServiceForModule(vin, req, resp)` | `22` / `21` / `1A` — module override, brand default, standard default |
| `identityBlockForVin(vin)` | Which DIDs identify an ECU on this brand and how their payloads are laid out |
| `platformForVin(vin)` / `profiledLevelForVin(vin)` / `gatewayBehaviourForVin(vin)` | Platform by sourced VDS pattern; how far the brand is profiled; what silence means |
| `overlayPacks()` | Every overlay pack under `data/packs/` with its own licence and provenance |

Full types in [`src/types.ts`](./src/types.ts) and field semantics in [`docs/uds/pack-schema-v9.md`](../../docs/uds/pack-schema-v9.md). The raw data file is also exported directly at `@scainner/uds-map/data/uds-map.json` if you'd rather parse it yourself in another language — it's plain JSON with no code dependency.

### Keeping the pack honest

- `pnpm lint:pack` fails on a DID without a module binding (unless marked `binding: "unknown"`), any entry without a `source`, a legacy scalar that disagrees with `decodes[0]`, a missing or unsupported `profiled_level`, and any brand token in `src/*.ts` — brands live in data, never in code.
- `pnpm coverage` regenerates [`COVERAGE.md`](./COVERAGE.md); `pnpm coverage:check` is what CI runs.
- Every fact migrated from `RESEARCH.md` prose into data is logged in [`docs/uds/migration-v9.md`](../../docs/uds/migration-v9.md).

## Contributing

Corrections and new brands are exactly what makes this useful — if you've verified an address or DID on real hardware, a PR with your confidence level and source is welcome. See `RESEARCH.md` for the confidence discipline this map holds itself to: an honest empty result beats a plausible-looking guess.

## License

Proprietary Scainner package; not published for public reuse. Third-party
knowledge retains its source licence and attribution. See the repository
`LICENSE`, `THIRD_PARTY_NOTICES.md`, and `data/packs/OBDB-NOTICE.md`.
