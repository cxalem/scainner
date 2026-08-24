# Scainner

A car diagnostic app for OBD2. It connects to an ELM327 Bluetooth adapter,
reads standard and manufacturer-specific data from the car, and records
everything to a local SQLite database while connected.

## What it does

- **Always-on recording.** While connected, every reading (engine sensors,
  fault codes, freeze frames) is written to SQLite automatically. No
  start/stop button — the database is the interface, and it's queryable
  directly with `sqlite3` or any tool that reads a SQLite file.
- **Health summary.** Fuel trims, cooling, battery voltage, and turbo boost
  are translated into plain-language statements (e.g. "reaches proper
  operating temperature and never overheats") instead of just raw numbers.
- **Fuel economy** computed from the ECU's own fuel-rate sensor: L/100km,
  cost per trip.
- **Diagnostic trouble codes**, read and cleared with verification (read →
  clear → read again, so the result shown is what actually happened, not an
  assumption).
- **UDS Lab** — read-only exploration of manufacturer-specific data beyond
  standard OBD2: scan a module's identifier space, and turn anything
  identified into a permanently recorded sensor.
- **Markdown export** of car info, recent scans, and sensor stats, sized to
  paste into a text conversation.

## Why it exists

It started from reverse-engineering a €18 Bluetooth ELM327 dongle against a
Citroën C4 III on 2026-08-14, then got extended into a UDS explorer for
data beyond what standard OBD2 exposes. The full write-up of that
reverse-engineering — CAN addresses, the dongle's connection quirks, how a
mystery data identifier was confirmed to be battery voltage — is in
[`UDS_INVESTIGATION_LOG.md`](./UDS_INVESTIGATION_LOG.md).

The long-term product direction—multi-brand diagnostic intelligence for
independent mechanics, evidence-guided fault classification, sensor
discovery, mechanic hypotheses, and professional reports—is documented in
[`docs/product/diagnostic-intelligence.md`](./docs/product/diagnostic-intelligence.md).
The phased engineering plan is in
[`docs/product/diagnostic-intelligence-implementation-plan.md`](./docs/product/diagnostic-intelligence-implementation-plan.md).

## Stack

Tauri 2 + Rust backend (serial driver, SQLite, background polling
supervisor) + React/TypeScript frontend (Tailwind, shadcn-style components,
lucide-react icons, recharts). No cloud, no telemetry, no account — the
database lives on your machine.

## Repository layout

The repo is a pnpm + Turborepo monorepo: `apps/desktop` (the Tauri app
described in this README), `apps/mobile` (an Expo app, early scaffold),
and `packages/core` (the shared Effect schemas and service contracts both
apps type against).

## Architecture

The backend is split by what each layer knows, so "how do I talk to the car"
(transport), "what does any car support" (standard OBD2), and "what does
*this* car's manufacturer support" (UDS) don't mix:

```
apps/desktop/src-tauri/src/
├── lib.rs              Tauri command surface — thin wrappers that either
│                        read the DB directly or `ask()` the supervisor
├── db.rs                SQLite layer: schema, migrations, every query
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

`handle_request` in `supervisor.rs` is the literal map from "UI asked for X"
to "which module answers X" — the file worth reading first to see how the
pieces fit.

The frontend is one file per screen under `apps/desktop/src/views/`, with
`views/lab/` holding the UDS Lab's five cards (module manager, DID reader,
range scanner, probe manager, module-fault clearer) as separate components.
The shared domain schemas and service contracts live in `packages/core`;
display metadata (gauge definitions, labels) in
`apps/desktop/src/shared/domain/gauges.ts`.

Frontend and backend only talk through Tauri's `invoke()`/event-emit bridge
— `lib.rs`'s `tauri::generate_handler![...]` list is the complete API
surface between them.

## Hardware

Built and tested against a **vGate iCar Pro** (classic-Bluetooth variant) on
**macOS**. The Bluetooth handling (PIN pairing, a "sulk mode" where the
dongle periodically stops answering until re-paired) is specific to that
dongle and this platform — see `apps/desktop/src-tauri/src/elm/driver.rs`, and
`UDS_INVESTIGATION_LOG.md` for how it was diagnosed. If your dongle
enumerates differently, override without touching code (from `apps/desktop`):

```bash
SCAINNER_OBD_PORT=/dev/cu.YourDongle SCAINNER_OBD_MAC=aa-bb-cc-dd-ee-ff SCAINNER_OBD_PIN=0000 pnpm tauri dev
```

The pairing PIN is not standardized across ELM327 clones — it's whatever
the manufacturer's Bluetooth module firmware expects. The app's default
(`1234`) covers roughly 90% of clones; the next most common are `0000` and
`1111`, occasionally `6789`. If pairing fails, try `SCAINNER_OBD_PIN` with
those before assuming something else is wrong.

Should work with any ELM327-compatible adapter with adjustments to the
connection layer. Windows/Linux support is unimplemented (the Bluetooth
reconnect logic shells out to macOS's `blueutil`) — see
[`BACKLOG.md`](./BACKLOG.md).

Reconnecting escalates through three strategies, cheapest first: open the
existing port directly, a plain Bluetooth disconnect/reconnect cycle, then a
full unpair-and-re-pair. The app remembers which step last worked and starts
there next time, so a dongle that always needs the full re-pair stops paying
for the two failed cheap attempts first.

## Bring your own car

Standard sensors (Dashboard, Live, History, Diagnose, Report) work on any
car — RPM, coolant, speed, fuel trims, fault codes, freeze frames. That's
plain OBD2/SAE J1979, the same on every vehicle sold since the early 2000s.

The UDS Lab's four built-in modules (BSI, ABS/ESP, cluster, engine) use
PSA/Stellantis CAN addresses (Peugeot, Citroën, DS, Opel), sourced from
[ludwig-v/arduino-psa-diag](https://github.com/ludwig-v/arduino-psa-diag).
On any other brand they won't answer.

To reach deeper data on a different brand: find your ECUs' UDS
request/response CAN IDs (car-hacking forums, brand-specific
reverse-engineering projects) and add a module through the Lab's **Add
module** button. The same scan/probe/clear workflow applies once it's there.
`UDS_INVESTIGATION_LOG.md` documents the method used to find and verify the
PSA addresses (broadcast probe → physical-address probe → session-open
check, then a DID-range scan correlated against a known value to identify
what an identifier measures) — the same method applies to any brand.

## Running it

```bash
pnpm install          # at the repo root
cd apps/desktop
pnpm tauri dev
```

Requires Rust + the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your platform, and an ELM327-compatible OBD2 adapter.

### Debugging

Console output is quiet by default (`info` level and above). For the
connection/scan internals, set `RUST_LOG`:

```bash
RUST_LOG=debug pnpm tauri dev   # connection lifecycle, scan start/end
RUST_LOG=trace pnpm tauri dev   # + per-DID scan progress
```

(Also from `apps/desktop`.)

### Tests

```bash
cd apps/desktop/src-tauri && cargo test   # parser + UDS decode logic — no hardware needed
pnpm typecheck                            # from the repo root: type-checks every package
```

Several Rust tests use real captured bytes from the author's car as fixtures
(`elm/parser.rs`, `elm/uds.rs`) — a pattern worth copying for your own
captures.

## Safety

Every diagnostic command this app sends is a read (`22`/`10`/`3E` in UDS
terms) except one, explicitly gated: clearing fault codes. That's the same
operation every commercial diagnostic tool performs, and it only erases
stored records — it cannot change how the car drives. There's no code path
that writes configuration, flashes firmware, or runs actuator/routine
commands. `apps/desktop/src-tauri/src/elm/uds.rs` is the file to check.

## License

MIT — see [LICENSE](./LICENSE).
