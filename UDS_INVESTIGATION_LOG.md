# UDS module investigation log

Running engineering log of the read-only UDS exploration on a Citroën C4 III
(1.2 PureTech; VIN redacted for the public repo). Kept for review by other models/sessions —
every entry states what was done, why, and what was learned. Append-only during a
session; do not rewrite past entries, add corrections as new entries instead.

**Ground rule enforced throughout:** every command sent to the car is limited to
UDS read services — `10` (DiagnosticSessionControl), `22` (ReadDataByIdentifier),
`3E` (TesterPresent) — plus, from this point on, the standard `14`
(ClearDiagnosticInformation) when the user explicitly asks to clear codes. No
`2E` (WriteDataByIdentifier), no routine control, no ECU flashing, ever.

---

## 2026-08-14 — Session 1: module discovery

**Goal:** find which PSA modules besides the engine ECU are reachable, and locate
battery state-of-charge/health data, motivated by the car's 2026-06 battery
replacement (see `2-Areas/Personal/citroen-c4-puretech-130.md`).

**Source for CAN addresses:** community-documented list at
[ludwig-v/arduino-psa-diag](https://github.com/ludwig-v/arduino-psa-diag/blob/master/ECU_LIST.md):
BSI 752:652, engine 6A8:688, ABS/ESP 6AD:68D, cluster 75F:65F.

**First attempt (`uds_hunt.py`, targeting BSI/cluster/ABS):** BSI opened a session
but the scan over `F080-F1FF` on the pre-set 20-minute run returned nothing before
the user asked to retry — stopped early, so BSI was never conclusively ruled in or
out on the D-zone.

**Recon pass** (`ATH1` broadcast `0100`, then physical probes on 6 candidate
address pairs incl. standard `7E0:7E8`/`7E1:7E9`):
- Broadcast `0100` only got one CAN responder: `7E8` (the engine, matches the
  vGate's default OBD-II addressing we've used all along).
- Physical-address probes: **BSI (752:652) and Cluster (75F:65F) did not open a
  diagnostic session** (`1003` → silent/NO DATA) over this dongle+bus path.
  **ABS/ESP (6AD:68D)** and **Engine (6A8:688)** both answered `1003` with a
  positive response.
  - Interpretation: either these two families genuinely aren't present on this
    car's variant, or the ELM/CAN-gateway path from the OBD port doesn't reach
    them (plausible — PSA cars increasingly gateway body-network traffic away
    from the diagnostic CAN bus reachable at the OBD-II port). Not yet certain
    which; noted as an open question below.
  - Standard PID engine address `7E0:7E8` also opened a session (7F 10 03 style
    reply, i.e. "response pending"/format quirk) — expected, redundant with 6A8.

**Decision:** retarget the hunt at the two modules that actually respond —
**Engine (6A8:688)** and **ABS/ESP (6AD:68D)** — rather than burn time against
silent addresses.

## Session 2: full hunt (`uds_hunt2.py`)

Ranges per module: `F080-F1FF` (ident zone), `D000-DFFF` (measurement zone — the
main PSA "live data" block), `2000-22FF` (small supplementary block seen in some
PSA dumps). `3E00` (TesterPresent) sent every 40 requests to hold the session.

**Results:**

| Module | F080–F1FF | D000–DFFF | 2000–22FF | Total |
|---|---|---|---|---|
| Engine (6A8:688) | 8 | 333 | 3 | 344 |
| ABS (6AD:68D) | 6 | 76 | 4 | 86 |

**430 identifiers answered in total** — full raw capture at
`hunt_results.txt` (session scratchpad; not yet copied into the repo — TODO).

**Known side effect:** holding extended diagnostic sessions on ABS+engine for
~15–20 minutes caused other modules to lose contact with them, which surfaced as
warning lights on the dash mid-scan. Read-only the whole time — nothing was
written to any module. Expected to self-clear on an ignition-off/on cycle once
the network re-syncs; flagged to the user as such, not yet confirmed cleared.

**Decoded identification strings** (ASCII inside `F1xx`/`F0xx` payloads):
- Engine `F180`: `VX56_L_29_07-6M     EB_DT_6_2-SER` — matches EB2 PureTech
  software family.
- Engine `F18C`: `9223214902` — likely a supplier/serial part number.
- ABS `D619`: `DSGiRESC00.1170001` — looks like an ESC/ABS software identifier.
- ABS `F08F`: `ESC  IPB Base` — confirms this ABS module is an IPB
  (Integrated Power Brake) unit, PSA's electric-boost brake system.
- ABS `F18C`: `285160352330060038D` — part/config number.

**Voltage candidates** (searching all payloads for values plausible as battery
voltage, cross-referenced against two independent known-good readings from
earlier sessions: mode-01 PID `0142` "control module voltage" = 13.96 V, and
`ATRV` dongle-side = 13.1 V, both taken 2026-08-14 while idling):
- `D422` = `05 87` → as big-endian centivolts: 1415 → **14.15 V**. Single clean
  2-byte value, no other plausible interpretation for those two bytes. Strongest
  candidate for "the engine ECU's own battery-voltage measurement", close to the
  0142 PID reading taken in an earlier session (not simultaneous, so not a hard
  match — engine load/RPM differs between sessions).
- `D4B1` = `83 00` → first byte as volts ×10: 131 → **13.1 V**. Notably matches
  the `ATRV` (dongle-side, post-wiring-drop) reading exactly, which is either a
  meaningful correlation or a coincidence given the value range is narrow.
- Several more single/double-byte hits fall in the 13.0–14.5 V band (`D477`,
  `D480`, `D4CB`, `D4CC`, `D4D3`, `D4EC`, `D612`, `D634`, `D66D`, `D71F`, `D74D`,
  `D76D`) — expected, since ~130-145 as a raw byte is a wide net and this engine
  has many voltage-adjacent sensors (rail pressure sensor supply, throttle body
  supply, etc.) that could coincidentally land in that byte range. Not
  battery-specific without further correlation.

**Percent-shaped candidates (single byte, engine, 0–100 range):** noted for
follow-up, not yet identified:
- `D604, D605, D606` = `96, 96, 96` — three consecutive DIDs, identical value.
  On a 3-cylinder engine this pattern (three near-identical DIDs) is a strong
  hint of **per-cylinder data** (e.g. individual-cylinder trim/quality/balance),
  not battery-related, but a good sign the D6xx block is per-cylinder
  diagnostics — useful for later (e.g. spotting one weak cylinder).
- `D638, D639, D63A` = `96, 96, 96` — same pattern repeated at a different
  offset; possibly a second per-cylinder metric.
- `D900 = 96`, `D902 = 100` — two round numbers close together; could be
  generic "health"/quality indices or unrelated small counters. Unidentified.
- No candidate yet confidently identified as **battery state-of-charge**
  specifically (as opposed to voltage). SOC/SOH may live on a module we
  couldn't reach (BSI), which is the module that typically owns battery
  management on PSA platforms — this would explain why the engine data has
  voltage-shaped values but nothing obviously percentage-shaped for charge
  state.

**Open questions carried forward:**
1. Is BSI truly unreachable from the OBD-II port on this car, or was the first
   (aborted) hunt just unlucky/too-short? Worth one more explicit, short,
   isolated retry (`1003` + a handful of probe DIDs, <1 min) before writing it
   off.
2. Which of `D422` vs `D4B1` (or another D4xx candidate) is actually battery
   voltage — needs a **live correlation read**: read the candidates and the
   standard PID `0142` back-to-back, ideally at two different engine states
   (idle vs ~2000 rpm) and see which candidate's value moves the same way.
3. `D604-D606` / `D638-D63A` per-cylinder theory untested — could confirm by
   revving the engine and re-reading to see if values respond to load.
4. Dashboard warning lights caused by the long diagnostic-session hold —
   pending confirmation they clear after an ignition cycle.

**Live correlation read** (two rounds, 3 s apart, standard PID `0142` +
`D422` + `D4B1` read back-to-back each round):

| | PID 0142 (known-good) | D422 → V | D4B1 → V |
|---|---|---|---|
| Round 1 | 14.17 V | `05 82` → 14.10 V | `83 00` → 13.10 V |
| Round 2 (+3s) | 14.17 V | `05 85` → 14.13 V | `83 00` → 13.10 V |

**Conclusion: `D422` is the engine ECU's live battery-voltage sensor.** It
tracks PID `0142` within ~0.1 V both times and *moves* slightly between reads
(0x0582 → 0x0585), consistent with a live-sampled value. Formula: big-endian
u16, ×0.01 → volts.

**`D4B1` is something else — did NOT move at all across the 3 s gap** (`83 00`
both times) despite `D422`/`0142` both shifting. Working theory: this is a
**latched/snapshot value** — e.g. "battery voltage at last key-on" or "resting
voltage before start" — rather than a live sample. That would actually make it
*more* interesting for battery-health tracking than a live voltage duplicate
(resting/key-on voltage is a classic simple health indicator), but this is
unconfirmed — needs a read on a different day / after the car has sat for
hours, to see if it updates then. Logged as an open item, not yet promoted to
a probe.

**Decision:** added `D422` (engine, confirmed live voltage) as a recorded UDS
probe. Held off on `D4B1` and the D604-606/D638-63A per-cylinder candidates —
not enough confidence yet to record them as labeled sensors; flagged for a
follow-up session (ideally: one read right after a cold start, one after the
car's sat overnight, to see which candidates move and how).

**Next planned actions:**
1. One more short, isolated BSI probe (not the full 20-min sweep) to settle
   open question #1 above.
2. Re-check `D4B1` after the car has sat several hours (cold key-on) to see if
   it updates — would confirm/deny the "resting voltage snapshot" theory.
3. Confirm the dash warning lights (caused by holding long diagnostic sessions
   on ABS/engine) clear after an ignition-off/on cycle.
4. Build a "clear module codes" action in the UDS Lab (ISO 14229 service `14`,
   ClearDiagnosticInformation) — user-requested, to fix exactly this kind of
   transient-DTC side effect without a trip to a shop. Confirm-gated like the
   existing engine-code clear.

**Actions completed same session:**
- Inserted `D422` as a live UDS probe directly into `scainner.sqlite3`
  (module=engine, offset 0, len 2, scale 0.01, bias 0, unit V) — Scainner will
  now record it automatically every ~30 s during normal driving alongside the
  standard PIDs. Went in via direct SQLite insert since the app wasn't running
  at the time (dongle held exclusively by the terminal hunt scripts); confirmed
  the row with `SELECT * FROM uds_probes`.
- Built and shipped the clear-module-codes feature: `uds::clear_dtcs()` sends
  ISO 14229 service `14FFFFFF` (ClearDiagnosticInformation, all DTC groups) —
  the only write operation this codebase performs anywhere, chosen because it's
  the same universally-safe "erase fault memory" call every commercial
  diagnostic tool uses; it can only erase stored records, never modify car
  behavior. Wired through the supervisor (`Request::UdsClear`), a Tauri
  command (`uds_clear`), and a confirm-gated button in the UDS Lab tab (mirrors
  the existing engine-code-clear UX: explicit "Clear codes on {module}…" →
  warning banner → "Yes, clear"). All 13 existing tests still pass, build is
  clean, no new warnings.
- **Confirmed by user (ignition cycle):** dashboard is all clear. The warning
  lights caused by holding long UDS sessions on ABS/engine were transient
  "lost communication" signals from other modules, and they self-cleared once
  the network resynced on restart — as expected, no lasting effect, no code
  clear was actually needed. Open question #4 closed.

## App bug: "scanning a DID range crashes the app"

**Root cause found:** `uds_scan_range` capped at 512 DIDs per call with a
1500ms per-DID read timeout (worst case ~13 min for one call), while the
Tauri command layer (`ask()` in `lib.rs`) had a hardcoded 60-second timeout on
*every* request, scans included. A 512-DID chunk running anywhere near its
worst case blew straight through that 60s ceiling: the frontend's `invoke()`
call would reject with "timed out waiting for dongle" and show an error, but
the backend's supervisor thread — which processes one request fully before
looking at the next — kept executing the scan to completion regardless,
during which the *entire* app was unresponsive: no live gauge updates,
Disconnect did nothing, nothing at all until the scan finished on its own
(anywhere from tens of seconds to several minutes later). That reads exactly
like a crash, and if the user force-quit a frozen-looking window during that
window, it effectively was one.

**Fix (all four parts needed together, not just one):**
1. `read_did` timeout for scans dropped from 1500ms → 600ms
   (`read_did_timeout`, new parameterized variant; single-DID reads elsewhere
   keep the safer 1500ms).
2. Per-call chunk cap dropped 512 → 256 DIDs, both backend
   (`from.saturating_add(255)`) and frontend (`SCAN_CHUNK = 256`, matched —
   otherwise the frontend would think it scanned DIDs the backend silently
   never got to).
3. `ask()`'s timeout raised 60s → 300s — a safety net now, not the everyday
   UX timer; normal requests still return in well under a second.
4. **Real cancellation added**, since raising the timeout alone doesn't help
   a scan that's genuinely still running: `Arc<AtomicBool>` `cancel_scan` on
   `Supervisor`, checked once per DID inside the scan loop (aborts within
   ≤600ms of being set), a new `uds_cancel_scan` command wired to a Cancel
   button that appears while a scan is running, and `disconnect()` now also
   sets the flag first — so Disconnect can no longer get stuck queued behind
   an in-progress scan.

Verified: 13/13 Rust tests still pass, zero build warnings, frontend
type-checks clean.

**Re-tested live against the car (same day):** user reported the crash still
happening after the first fix. Added full tracing to the scan path (per-DID
progress every 32 iterations, setup/teardown/send-result logging) plus
hardened every shared-mutex lock site against poisoning
(`lock_or_recover` helper — previously several commands used a bare
`.lock().unwrap()`, so a single panic anywhere while holding that lock would
have made *every* other command panic forever after, a real cascading-failure
risk even if not the actual cause here) and added a React error boundary
(previously any uncaught frontend exception would blank/freeze the window
with the Rust backend still alive underneath — indistinguishable from a
crash, with zero prior evidence either way).

Watched a live retry end-to-end: user scanned `D000-D1FF` on **BSI** — the
module already known to be silent from the original hunt. Both 256-DID
chunks completed cleanly (0 hits, 0 errors, clean teardown, result delivered
to frontend both times) — **no crash, no panic, no hang** in the traced run.
**Conclusion: the underlying bug from the first fix is resolved.** What the
user was very plausibly experiencing was the *absence of the actual crash* —
a fully silent module (BSI, confirmed dead again here across another 512
DIDs) gives zero visual feedback for the 1-2 minutes each chunk takes to
individually time out on every single DID, which looks identical to frozen.
**Fixed same session** (confirmed live, mid-scan, while a third BSI chunk was
still running): backend now emits a `uds-scan-progress` event every 8 DIDs
(current/total/did/hits-so-far) via `app.emit` — required threading an
`AppHandle` down through `handle_request` into `uds_scan_range`, which didn't
have one before. Frontend listens and renders a real progress bar + live
"checking DXXX… N/256" counter + a reassurance note once it's clear a module
is answering nothing ("no answers yet; some modules stay silent for a whole
range, that's normal"), plus the Scan button itself now shows a running hit
count. This directly closes the perception gap that made a perfectly healthy
silent-module scan look identical to a frozen app.

**BSI dead-end now doubly confirmed** (512 DIDs across two independent
sessions, zero responses) — closes open question #1 for good. BSI's battery
data, if it exists at all in a form reachable from the OBD-II port, is not
accessible via this dongle's CAN path on this car.

## 2026-08-15 — 29-bit addressing probe (negative, closes the topic)

Motivated by the service-counter reset question (counter lives on BSI/cluster).
Tried ISO 15765-4 29-bit extended addressing (`ATSP7`) on the same OBD pins:
functional `0100` broadcast → NO DATA; physical `18DAxxF1` probes across 18
plausible target addresses (incl. classic PSA body/cluster IDs) → zero
responses, not even the engine ECU (which always answers on 11-bit). 

**Conclusion:** this car's OBD-accessible bus is 11-bit CAN only, and the
BSI/cluster are isolated from it — most likely at the physical layer: PSA
routes internal buses on *different OBD connector pins*, and professional
tools (DiagBox/Lexia, iCarsoft CR MAX) contain multiplexer hardware that can
switch pin pairs. An ELM327-class dongle is hardwired to pins 6/14; no
software can route around missing copper. Service-counter reset therefore
requires a multiplexed tool (dealer/CR MAX) or the cluster's own button
procedure. Wall confirmed at every layer we can touch; topic closed.
