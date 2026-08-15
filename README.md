# Scainner

A car diagnostic app that records everything and forgets nothing — built so an
AI can read your car's history the way it reads a codebase.

Most OBD2 apps show you a number and let it evaporate. Scainner is the
opposite bet: every second your car is connected, it's writing to a local
SQLite database — engine sensors, fault codes with freeze frames, and
manufacturer-specific data you find yourself. Ask "has my battery voltage
been trending down?" or "did the coolant ever overheat this month?" and the
answer is a query away, not a memory.

Built in a single day (2026-08-14) reverse-engineering a €18 Bluetooth ELM327
dongle against a Citroën C4 III, then extended into a UDS explorer for
manufacturer-specific diagnostics. Full write-up of the reverse-engineering
in [`UDS_INVESTIGATION_LOG.md`](./UDS_INVESTIGATION_LOG.md).

## What it does

- **Always-on recording** — connect once, every drive is logged automatically.
  No "start recording" button; the database is the interface.
- **Plain-language health verdicts** — fuel trims, cooling, battery, and
  turbo boost translated into sentences a non-technical owner can act on,
  not just raw numbers.
- **Fuel economy** from the ECU's own fuel-rate sensor — L/100km, cost per
  trip, no guessing.
- **Diagnostic trouble codes** with freeze frames and a verified clear
  (read → clear → re-read, so you know it actually worked).
- **UDS Lab** — read-only exploration of manufacturer-specific data beyond
  standard OBD2 (the stuff Car Scanner and friends can't touch). Scan a
  module's identifier space, find something interesting, turn it into a
  permanently recorded sensor in a few clicks.
- **AI briefing export** — one click builds a markdown summary (car info,
  recent scans, sensor stats) sized to paste into any AI chat.

## Why this over [insert commodity OBD app]

Because the value compounds. A live-only tool answers "what's my RPM right
now"; this answers "how has my car changed since I fixed X" — six months
later, from a database, not a screenshot folder.

The AI angle: an OBD2-to-MCP idea has already been independently proven by
[petrpatek/obd2-mcp-server](https://github.com/petrpatek/obd2-mcp-server) and
others — live reads bridged to Claude. Scainner takes the same idea further:
the interesting question isn't "what is my car doing right now," it's "what
has my car been doing" — and that needs persistence, which live-read tools
don't have. (MCP server for querying Scainner's own history: see the
[backlog](./BACKLOG.md).)

## Stack

Tauri 2 + Rust backend (serial driver, SQLite, background polling
supervisor) + React/TypeScript frontend (Tailwind, shadcn-style components,
lucide-react icons, recharts). No cloud, no telemetry, no account — the
database lives on your machine.

## Architecture

The backend is split by what each layer knows, so "how do I talk to the car"
(transport), "what does any car support" (standard OBD2), and "what does
*this* car's manufacturer support" (UDS) never bleed into each other:

```
src-tauri/src/
├── lib.rs              Tauri command surface — thin wrappers that either
│                        read the DB directly or `ask()` the supervisor
├── db.rs                SQLite layer: schema, migrations, every query.
│                        This IS the product — see the intro above.
└── elm/
    ├── driver.rs         Raw serial transport (termios) + macOS Bluetooth
    │                     lifecycle (pairing, the dongle's "sulk mode" cure)
    ├── parser.rs          Pure decode functions: ELM response → bytes →
    │                      typed values. No I/O, fully unit-testable.
    ├── obd.rs              Standard OBD2 (SAE J1979): DTC scans, freeze
    │                       frames, ECU identity, readiness monitors.
    │                       Works on any car.
    ├── uds.rs               Manufacturer-specific (ISO 14229): module
    │                        read/scan/clear, the probe system. PSA
    │                        defaults built in, brand-agnostic by design.
    └── supervisor.rs         Connection lifecycle + live polling loop on a
                               background thread; dispatches UI requests to
                               obd:: or uds:: — the seam between them.
```

`supervisor.rs` used to be a 700-line file mixing all of the above; it's the
one file worth reading first if you want to see how the pieces fit, since
`handle_request` there is the literal map from "UI asked for X" to "which
module answers X."

The frontend mirrors the same instinct — one file per screen under
`src/views/`, with `views/lab/` holding the UDS Lab's five cards (module
manager, DID reader, range scanner, probe manager, module-fault clearer) as
separate components rather than one 500-line file. Shared types and sensor
metadata live in `src/lib/meta.ts`.

Frontend and backend never share code directly — they talk exclusively
through Tauri's `invoke()`/event-emit bridge, so `lib.rs`'s
`tauri::generate_handler![...]` list is the complete API surface between them.

## Hardware

Built and tested against a **vGate iCar Pro** (classic-Bluetooth variant) on
**macOS**. The Bluetooth handling (PIN pairing, a documented "sulk mode"
where the dongle periodically stops answering until re-paired) is specific
to that dongle and this platform — see `src-tauri/src/elm/driver.rs` for the
gory details, and `UDS_INVESTIGATION_LOG.md` for how they were diagnosed.
If your dongle enumerates differently, override it without touching code:

```bash
SCAINNER_OBD_PORT=/dev/cu.YourDongle SCAINNER_OBD_MAC=aa-bb-cc-dd-ee-ff SCAINNER_OBD_PIN=0000 pnpm tauri dev
```

**The PIN is not standardized across ELM327 clones** — it's whatever the
manufacturer programmed into the Bluetooth module's firmware, and there's no
spec forcing agreement. The app's default (`1234`) covers roughly 90% of
clones on the market; the two next most common are `0000` and `1111`,
occasionally `6789`. If pairing fails, `SCAINNER_OBD_PIN` is the first thing
to try changing — cycle through those four before assuming something else is
wrong. Your dongle's manual or listing page usually states it outright if
it's non-default.

Should work with any ELM327-compatible adapter with adjustments to the
connection layer. Windows/Linux support is unimplemented (the Bluetooth
reconnect logic shells out to macOS's `blueutil`) — see
[`BACKLOG.md`](./BACKLOG.md).

### The connection ladder tunes itself per dongle

Reconnecting escalates through three strategies, cheapest first: open the
existing port directly, a plain Bluetooth disconnect/reconnect cycle, then —
only if those fail — a full unpair-and-re-pair with `SCAINNER_OBD_PIN`. The
last one is deliberately not the default starting point: it's heavier on the
OS Bluetooth stack, and jumping straight to it would be wrong for any dongle
healthier than the author's (most reconnect fine at step one or two).

What actually happens is adaptive: the app remembers which step last worked
and starts there on the next connection, so a dongle that needs the full
re-pair every time (like the one this was built against) stops paying for
the two failed cheap attempts first, while a better-behaved dongle just
stays fast. Nothing to configure — it learns from your specific hardware
automatically after the first successful connection.

## Bring your own car

**Standard sensors (Dashboard, Live, History, Diagnose, Report) already work
on any car** — RPM, coolant, speed, fuel trims, fault codes, freeze frames.
That's plain OBD2/SAE J1979, the same on every vehicle sold since the early
2000s. Connect and drive; the recording starts itself.

**The UDS Lab is different: its four built-in modules (BSI, ABS/ESP,
cluster, engine) are PSA/Stellantis-specific** — CAN addresses from the
community-documented [ludwig-v/arduino-psa-diag](https://github.com/ludwig-v/arduino-psa-diag)
project, only correct for Peugeot/Citroën/DS/Opel. On any other brand, they
simply won't answer.

To reach deeper data on a different brand: find your ECUs' UDS request/
response CAN IDs (car-hacking forums, brand-specific reverse-engineering
projects, or a search for "\<your car\> UDS diagnostic session CAN ID"
usually turns something up) and add a module through the Lab's **Add
module** button — same scan/probe/clear workflow applies unchanged once it's
there. `UDS_INVESTIGATION_LOG.md` is the receipt for exactly how the PSA
addresses above were found and verified (broadcast probe → physical-address
probe → session-open check, then a DID-range hunt correlated against a known
value to identify what a mystery identifier actually measures) — the same
method works on any brand, it's just legwork.

## Running it

```bash
pnpm install
pnpm tauri dev
```

Requires Rust + the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your platform, and an ELM327-compatible OBD2 adapter.

### Debugging

Console output is quiet by default (`info` level and above only). For the
connection/scan internals — every Bluetooth command, every DID probed during
a range scan — set `RUST_LOG`:

```bash
RUST_LOG=debug pnpm tauri dev   # connection lifecycle, scan start/end
RUST_LOG=trace pnpm tauri dev   # + per-DID scan progress
```

### Tests

```bash
cd src-tauri && cargo test   # parser + UDS decode logic — no hardware needed
pnpm exec tsc --noEmit       # frontend type-check
```

The Rust tests are the useful ones to read if you're adding a new sensor
decode or UDS extraction — several use real captured bytes from the author's
car as fixtures (`elm/parser.rs`, `elm/uds.rs`), which is a nice pattern to
copy for your own captures.

## Safety

Every diagnostic command this app sends is a **read** (`22`/`10`/`3E` in UDS
terms) except one, explicitly gated: clearing fault codes. That's the same
operation every commercial diagnostic tool performs and it only erases
stored records — it cannot change how your car drives. There is no code path
that writes configuration, flashes firmware, or runs actuator/routine
commands. Read `src-tauri/src/elm/uds.rs` yourself and check — it's a single
focused file, not spread across the codebase where something could hide.

## License

MIT — see [LICENSE](./LICENSE).
