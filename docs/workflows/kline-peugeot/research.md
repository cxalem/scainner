# Talking to the old Peugeot ("Yuli Peugeot") — K-line research

2026-08-21, from live observations the same night the car first connected.
Goal: learn how to get MORE out of this ~1999-2000 Peugeot than the handful
of standard PIDs it answers today.

## What we know for certain (observed, not guessed)

- **Protocol: ISO 14230-4 KWP, fast init** — the adapter's own `ATDPN`
  returned `5`. This is K-line (OBD pin 7) at 10.4 kbaud, NOT CAN. Every
  CAN-based thing in the app (the UDS Lab's module scanning, `ATSH`/`ATCRA`
  11-bit addressing) is structurally inapplicable to this car.
- **Mode 09 (VIN) is genuinely unsupported**: `0902` returned 0 bytes on
  every attempt across multiple connects and a dongle power-cycle, with an
  otherwise-responsive bus. Consistent with a pre-2001 EOBD-era ECU.
- **Mode 01 PIDs actually answered** (post parser-fix, honest set from the
  poll loop): `04` load, `05` coolant, `0C` rpm, `0D` speed, `0F` intake
  temp. NOT answered from the poll set: `06/07` fuel trims, `0B` MAP, `0E`
  timing advance, `11` throttle, `2F` fuel level, `5E` fuel rate.
- **Mode 01 PID 01 (MIL/DTC count), mode 03 (stored DTCs), and mode 02
  (freeze frame) work**: the live scan that explained the dashboard light
  came from this car — MIL on, stored `P0204` (cyl 4 injector circuit),
  freeze frame trigger recorded `P0402` (EGR excessive flow). A "P0A11"
  seen in one mode-0A read is almost certainly a decode artifact (mode 0A
  isn't defined this far back), not a real hybrid-drivetrain code — treat
  mode 0A output from this car as untrustworthy.
- Battery voltage via `ATRV` works (that's dongle-local, no bus involved).

## What this implies

This ECU speaks **KWP2000 (ISO 14230)** — and the OBD subset we use (modes
01/02/03) is only the standardized corner of KWP. The same protocol carries
manufacturer diagnostic services this era's dealer tools (PSA Lexia/PP2000)
used over this exact wire. An ELM327 can issue those raw services. The
promising, read-only ones:

| Service | Name | Why it matters here |
|---|---|---|
| `1A xx` | readEcuIdentification | ID blocks `0x80–0x9F`; on many KWP ECUs **`1A 90` returns the VIN** even though OBD mode 09 doesn't exist. Also spare-part numbers, SW/HW versions — real identity for a car that can't otherwise state one. |
| `21 xx` | readDataByLocalIdentifier | The K-line analog of our CAN DID scanning: PSA-specific data tables (sensor values beyond mode 01) live behind local IDs `0x01–0xFF`. This is the door to "more sensors than OBD exposes." |
| `18 00 FF FF` | readDTCsByStatus | Manufacturer DTCs beyond mode 03's standardized list. |
| `10 8x`/`10 C0` | startDiagnosticSession | May be a prerequisite for some `21` tables (PSA tools open a session first). Read-oriented; times out back to normal on its own. Try WITHOUT it first. |
| `3E` | testerPresent | Keepalive; the ELM's ISO wakeup handling (`ATSW`) usually covers this. |

Relevant ELM327 knobs (all in the v1.4+ command set the clone supports):
`ATSP 5` (force KWP fast), `ATSI`/`ATFI` (slow/fast init), `ATH1` (show
headers — essential for reading raw KWP responses), `ATSH xx yy zz` (set
the 3-byte header: format, target, source — e.g. `C2 33 F1` functional,
`80 10 F1` physical to target `0x10`), `ATIIA hh` (init address for slow
init), `ATKW` (show key bytes), `ATST hh` (response timeout).

## Honest unknowns

- Which PSA target addresses answer on this car's K-line (engine ECU
  usually reachable via the functional `33`/default OBD init that already
  works; ABS/airbag on cars this old were often on a SEPARATE pre-OBD
  connector, not pin 7 — may simply not be reachable through the OBD port).
- Which `21` local IDs hold what — that's exactly what the probe below
  maps, the same empirical approach that found `D422` on the Citroën.
- Whether any `1A` block actually carries a VIN on this specific ECU
  (implementation-dependent) — cheap to test, huge if true: it would give
  Yuli Peugeot a real VIN and automatic recognition on reconnect.
- Exact model/engine of the car (ask the owner / check the doorjamb plate
  — knowing engine + year narrows which ECU family: Bosch Motronic MP7.x,
  Magneti Marelli 1AP, Sagem SL96 are the usual suspects for late-90s PSA
  petrol; each has known `21` table layouts in the enthusiast community).

## The experiment: `docs/uds/kline_probe.py`

A ready-to-run, **read-only** probe over the same python harness the
Citroën UDS hunt used (`uds_common.py`): confirms the bus, dumps the
supported-PID bitmap, sweeps `1A 80–9F`, sweeps `21 00–FF`, tries
`18 00 FF FF` — printing every positive response with raw bytes + ASCII.
Run it with the ignition on, engine running or not, and the DESKTOP APP
CLOSED (it needs the serial port). Explicitly does NOT send: any `14`/`04`
clear, any `2E/3B` write, any `31` routine — probing must not change the
car.

## If the probe finds real data → build step (later, not now)

A "K-line Lab" increment: the existing Lab's probe machinery (identify a
value → save as a recorded probe → charted in History) generalized so a
probe can be a KWP `21` local-ID read on ISO 14230 instead of a CAN UDS
`22` DID. The schema already fits (`uds_probes.module` + did are just
numbers; the transport layer is what differs). Not built until the probe
proves there's something worth reading.
