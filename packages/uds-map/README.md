# @scainner/uds-map

A queryable knowledge map of manufacturer-specific **UDS (ISO 14229)** diagnostic addresses and DID (Data Identifier) ranges — the data that lets a diagnostic tool find *more* than the standardized OBD2 PID set exposes: battery state, tire pressure, per-module identification, and hundreds of other manufacturer-specific values, keyed by VIN.

Extracted from [Scainner](https://github.com/cxalem/scainner), an open-source car-diagnostics app, where this exact file drives its one-button sensor auto-discovery engine.

**21 brands. 251 VIN (WMI) prefixes. 180+ modules. 180+ identified DIDs**, each with a `confidence` level (`confirmed` / `high` / `medium` / `low`) reflecting how independently verified it is. See [`RESEARCH.md`](./RESEARCH.md) for full per-brand provenance, sources, and known gaps.

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

const vin = "VR7EXAMPLE0000001"; // a synthetic example VIN (PSA WMI prefix)

brandForVin(vin);
// => { id: "psa", name: "PSA / Stellantis...", wmi: [...], modules: [...], ... }

bandsForVin(vin);
// => [[0xD400, 0xD4FF], [0xD600, 0xD6FF], ...] — confidence-ordered DID
//    neighborhoods worth sweeping for this brand, confirmed bands first

addressesToProbe(vin);
// => this brand's documented module addresses first, then the full
//    11-bit conventional range behind them, with each response address
//    derived using the brand's actual offset rule (see below)

const battery = knownDid(vin, 0xd422);
// => { did: "D422", label: "Battery voltage...", unit: "V",
//      offset: 0, len: 2, scale: 0.01, bias: 0, confidence: "confirmed" }

decodeKnownDid(battery!, [0x05, 0x50]); // apply offset/len/scale/bias to raw response bytes
// => 13.6
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
| `knownDid(vin, did)` | A documented label + decode formula for a specific DID, if the map has one |
| `decodeKnownDid(known, bytes)` | Apply a `KnownDid`'s offset/len/scale/bias to raw response bytes |

Full types in [`src/types.ts`](./src/types.ts). The raw data file is also exported directly at `@scainner/uds-map/data/uds-map.json` if you'd rather parse it yourself in another language — it's plain JSON with no code dependency.

## Contributing

Corrections and new brands are exactly what makes this useful — if you've verified an address or DID on real hardware, a PR with your confidence level and source is welcome. See `RESEARCH.md` for the confidence discipline this map holds itself to: an honest empty result beats a plausible-looking guess.

## License

MIT
