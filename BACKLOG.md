# Scainner backlog

✅ **MVP (2026-08-14)**: connection supervisor (with automatic PIN re-pair self-heal) ·
live dashboard · always-on SQLite recording · DTC panel with history · pre-ITV
readiness card · My Car/ECU card · export. First real drive recorded same day.

✅ **Wave 2 (2026-08-14)**: Trends tab (recharts, PID + range selector) · Alerts
(coolant >105 °C, voltage <11.8 V sustained while running, MIL-on watch every ~1 min) ·
Freeze frame (mode 02 capture on scans with stored codes) · "Copy AI briefing"
(markdown context dump) · All Sensors tab (live 0100/0120/0140/0160 PID discovery +
~40-PID catalog, one-sweep read).

✅ **Wave 3 (2026-08-14): UDS Lab** — read-only UDS (mode 22) access to ABS/ESP
(6AD:68D) and engine (6A8:688) — BSI and cluster don't answer over this dongle's
path (see `UDS_INVESTIGATION_LOG.md`). Single-DID read, chunked range scanner, a
**probe system** (identified DIDs → user-defined probes polled every ~30s and
recorded as `uds_*` readings, chartable in Trends), and a confirm-gated
**clear-module-codes** button (ISO 14229 service `14`). Live hunt on 2026-08-14
found 430 identifiers across the two modules; `D422` confirmed as live battery
voltage via correlation against the standard voltage PID and added as a
recorded probe. Full raw capture + scripts in `docs/uds/`.

✅ **Fuel economy** (2026-08-14) — Report tab's Fuel card: L/100km, €/100km,
fuel used, distance, all from the ECU's own fuel-rate PID (0x5E). Editable fuel
price.

✅ **UI redesign** (2026-08-15) — sidebar navigation replacing 7 flat tabs, grouped
by intent (Overview/Live/History/Diagnose, divider, Lab/Vehicle); persistent
connection card; zero emojis (lucide-react icons throughout); focus rings, aria
labels, `prefers-reduced-motion`; `brand.md` documents the palette/voice. App went
from ~1,400-line monolith to `src/views/*.tsx` + shared `src/lib/meta.ts`. Also:
fast-path reconnect (skip the Bluetooth cycle when the port's already alive, ~10s
→ ~3s), module-fault verified-clear UX (read → clear → re-read, explicit
before/after instead of a blind "done" button), and a real Cancel + live progress
bar for range scans (root-caused a "looks like a crash" report to a healthy but
silent module giving zero UI feedback for 60+ seconds — fixed the feedback, not a
bug in the scan itself).

✅ **Open-sourced, brand-generic** (2026-08-15) — UDS modules moved from a
hardcoded PSA-only Rust array to a DB-backed list (`uds_modules` table): the four
PSA defaults ship built-in, and an **"Add module"** flow in the Lab lets anyone
add their own brand's CAN request/response IDs and get the same scan/probe/clear
workflow. Standard-OBD views (Dashboard/Live/History/Diagnose/Report) already
worked on any car (SAE J1979) — this was the one PSA-only piece. Connection
config (port/MAC/PIN) now overridable via `SCAINNER_OBD_PORT`/`_MAC`/`_PIN` env
vars instead of hardcoded to the author's dongle. Real VIN scrubbed from the test
suite and docs before publishing. MIT license, real README, `.gitignore` excludes
`target/` and any `*.sqlite3` (real car data never belongs in the repo).

## Deferred (in rough priority order)

1. **MCP server** — expose the SQLite DB (and ideally live control) as an MCP
   server so any AI client can query car history natively, not just via the
   in-app "Copy AI briefing" button. Natural next open-source milestone —
   validates against existing live-only OBD2 MCP projects
   (petrpatek/obd2-mcp-server) by being the persistent-history version they
   don't have. Needs: a synthetic demo SQLite dataset so people without a car
   can try it (`docs/demo-data/` or similar), and a decision on read-only-v1
   vs. also bridging live commands to the running Tauri app.
2. **Battery state-of-charge (not just voltage)** — `D422` gives live voltage,
   confirmed. True SOC/SOH likely lives on the BSI, which didn't respond to a
   diagnostic session over this dongle's CAN path even on a 29-bit-addressing
   retry (2026-08-15) — closed as a hardware wall, not a software gap (see log).
   `D4B1` is an unconfirmed secondary candidate (looked like a latched/snapshot
   value, not live) — needs a cold-start re-read to test that theory.
3. **Acceleration tests** — needs burst polling (single-PID tight loop) for useful
   0–100 accuracy; current 1 Hz multi-PID loop gives ±1 s.
4. **HUD mode** — fullscreen mirrored display (parked laptop on dash, why not).
5. **Multi-car support** — profiles keyed by VIN (girlfriend's car, Jesús's Kona…).
   The DB schema already stamps sessions by VIN; needs a UI car-switcher beyond
   Report's existing selector.
6. **Windows/Linux build** — serial path + reconnect are the only macOS-specific bits
    (blueutil); abstract behind a trait when the time comes.

## Non-goals (for now)

- Full-module PSA diagnostics (BSI/ADAS/HVAC), BMS battery registration, EPB service —
  that's CR MAX territory, not doable over a generic ELM327.
- Android/iOS builds.
