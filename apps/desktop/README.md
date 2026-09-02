# The desktop app

The Tauri app. `pnpm tauri dev` from this directory runs it against a real
adapter — see the [repo README](../../README.md#running-it) for the Rust and
hardware prerequisites.

## The browser preview

The whole frontend also runs in a plain browser tab, with no Rust, no adapter
and no car:

```bash
pnpm dev          # from apps/desktop → http://localhost:1420
```

Every view imports `invoke`/`listen` from `src/lib/tauri.ts`, which routes to
`src/lib/mock.ts` whenever the app is not inside a Tauri window. The mock
carries demo data and a small event bus, so the preview walks the real flows:
connect, first-connect discovery, the sensor scan, the fault scan, the UDS Lab.

The demo car and every module address, identifier and plan name in the mock
are derived from the UDS knowledge pack at load time — there are no
brand-specific literals in the preview, and `mock.ts` never ships in a real
build.

### Pacing knobs

The mock walks its stages faster than anyone can look at them, which makes
three real states hard to inspect: Overview's scan banner, Live's "the gauges
are paused" notice, and the Lab card's progress bar. So the pace is a knob.

Each is read fresh on every stage, and the URL wins over the environment
variable, because the URL is what you can change without restarting the dev
server.

| Query parameter | Env default | Falls back to | What it does |
|---|---|---|---|
| `?mock_discovery_ms=<ms>` | `VITE_MOCK_DISCOVERY_MS` | `900` | ms per discovery stage (census → identity → join → coverage) |
| `?mock_connect_ms=<ms>` | `VITE_MOCK_CONNECT_MS` | `300` | ms per connect stage (link → open → handshake → bus) |
| `?mock_discovery_hold=<stage>` | — | not held | parks the discovery run **on** that stage, indefinitely |
| `?mock_connect_fail=<stage>` | — | connects | fails the connect at that stage, so the gate's failure toast is reachable |

A value that is not a non-negative number is ignored rather than obeyed — a
typo should not freeze the preview.

```bash
# six seconds a stage: long enough to read the banner, the notice and the bar
open 'http://localhost:1420/?mock_discovery_ms=6000'

# stop on "join" and stay there
open 'http://localhost:1420/?mock_discovery_hold=join'

# the connect-failure toast, with its two actions and its Details disclosure
open 'http://localhost:1420/?mock_connect_fail=handshake'

# a session-wide default instead of a query string
VITE_MOCK_DISCOVERY_MS=6000 pnpm dev
```

**The hold** is the one that actually makes a state inspectable, because it
holds still while you read it, screenshot it, or open devtools. There are two
ways out of it, and the mock polls for both:

```js
// in the browser console
__sonda_mock.release()        // let the held run carry on
__sonda_mock.hold("coverage") // hold a different stage, no reload
__sonda_mock.hold(null)       // stop holding, no reload
__sonda_mock.pacing()         // { discovery: 6000, connect: 300 }
```

`window.__sonda_mock` exists only in the preview: it is installed by
`mock.ts`, which is loaded only when the app is outside a Tauri window.

## Tests

```bash
pnpm test         # vitest — the pure logic modules under src/lib, src/theme
pnpm typecheck
pnpm build
```

`src-tauri` has its own Rust tests: `cd src-tauri && cargo test`.

## Components

New components come from shadcn/ui, into `src/components/ui/`. The hand-made
kit in `src/components/ui.tsx` is frozen. See
[`docs/redesign/03-shadcn.md`](../../docs/redesign/03-shadcn.md) for the rule
and the token mapping.
