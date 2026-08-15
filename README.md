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

Should work with any ELM327-compatible adapter with adjustments to the
connection layer. Windows/Linux support is unimplemented (the Bluetooth
reconnect logic shells out to macOS's `blueutil`) — see
[`BACKLOG.md`](./BACKLOG.md).

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

## Safety

Every diagnostic command this app sends is a **read** (`22`/`10`/`3E` in UDS
terms) except one, explicitly gated: clearing fault codes. That's the same
operation every commercial diagnostic tool performs and it only erases
stored records — it cannot change how your car drives. There is no code path
that writes configuration, flashes firmware, or runs actuator/routine
commands. Read `src-tauri/src/elm/uds.rs` yourself; it's short.

## License

MIT — see [LICENSE](./LICENSE).
