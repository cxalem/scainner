# Plan: Windows transport, pre-hardware increments

Stream family: `windows-port`. Base: `origin/main@c612e1b`. No builder starts before the human gate.

## Goal

Preserve Wi-Fi and add Windows COM transport for USB ELM327 and manually paired Classic
Bluetooth SPP. Prove each PR on Windows CI; preserve Unix termios and evidence-bounded claims.

## Gate decisions and recommendations

1. **Serial:** accept Windows-only `serialport = "=4.10.0"` plus MPL notice. Recommended: yes; raw WinAPI is fallback.
2. **Bluetooth v1:** manual pairing/COM selection; defer cycle/re-pair and RFCOMM. Recommended: yes.
3. **Windows:** validate 11 first; treat 10 as best-effort until an owner supplies a test machine.
4. **Claim:** not "user-ready Windows" until Choose adapter exists. Include it here or separately?
5. **I/O fixture:** name an authorized Windows machine and verified serial pair before stream 2; no patched com0com. Without one, OS-I/O acceptance is incomplete.

## Non-goals

- No BLE, automatic Windows pairing, direct RFCOMM, ARM64, protocol/UDS or writes.
- No installer UX/signing/publication review; only notice-resource presence is checked.
- No replacement of Unix termios and no changes to `tcp_elm.rs`.
- Virtual I/O does not prove ELM timing/pairing. SCAINNER-03 remains separate.

## Ordered streams

Each item gets its own worktree, `ws/*` branch and PR; no concurrent file ownership.

### 1. `ws/windows-rust-ci` - establish the proof surface

Boundary: `.github/workflows/ci.yml` only.

- Add a PR-triggered `windows-latest` Rust job using stable MSVC.
- Run `cargo check --locked --all-targets`, Clippy without inventing a stricter
  warning gate, and a real `cargo test --locked --all-targets` from `src-tauri`.
- Keep the Ubuntu job and Tauri prerequisites. Acceptance: both jobs pass and Actions
  logs show tests executed, not a cache-only success.
- This CI/deployment-config stream gets independent review before merge.

### 2. `ws/windows-port-serial` - risk-first COM I/O

Boundary: `apps/desktop/src-tauri/{Cargo.toml,Cargo.lock,tauri.conf.json}`,
`src/elm/transport/elm_serial.rs`, and `THIRD_PARTY_NOTICES.md`.

- Add the exact crate version under `target.'cfg(windows)'.dependencies`; do not
  route Unix through it.
- Give `ElmSerial` a Windows-owned port. Configure baud, 8N1 and no flow control;
  retain the 15 second open deadline and close-on-drop. Do not guess DTR behavior;
  make the required fixture establish whether the target needs it.
- Before each command clear input; write the full command plus carriage return;
  flush; map serial read timeouts to the existing zero-byte polling loop.
- Add Windows-gated error/timeout tests and platform-neutral prompt-loop tests. Do
  not create a fake test that bypasses the adapter.
- Add a notice with version, MPL text/source links and the immutable crates.io source
  archive; bundle it as a Tauri resource and record it in the SBOM.
- On the Windows fixture, run pinned `cargo-cyclonedx 0.5.9` via
  `cargo cyclonedx -f json -a`; save `scainner-windows.cdx.json` as untracked evidence.
  Require `pkg:cargo/serialport@4.10.0`, `MPL-2.0` and final dependency inspection due
  to an upstream target limitation. José/Alejandro attaches it and records the link.
- Build/install an internal NSIS test; PowerShell `Get-ChildItem`/`Select-String` proves
  the notice/source link shipped. Updater artifacts may be disabled without signing
  access; signing/publication remain SCAINNER-03 gates.
- Acceptance: Windows/Ubuntu CI pass and the named fixture proves `ATZ`, `ATI`, prompt
  reads, stale-input purge, timeout and the observed DTR requirement/behavior. The PR
  records that result even when no DTR assertion is needed. Otherwise it is incomplete.
- Risk fallback: if the fixture cannot reproduce the semantics, stop and re-plan
  raw `windows-sys` plus enumeration. Do not leave a hidden crate dependency.

### 3. `ws/windows-port-supervisor` - make COM direct-open reachable

Boundary: `apps/desktop/src-tauri/src/elm/supervisor.rs` and its tests.

- Replace filesystem existence as the universal direct-open gate with an explicit
  platform-aware decision. A configured Windows COM port gets attempt 0 directly.
- Force start 0 even when a migrated profile has `bt_addr` and learned level 1 or 2.
- Extract a pure retry-policy helper inside this file; feed it platform, configured
  path and synthetic open/probe outcomes so its tests need no real COM device.
- Preserve the learned macOS reconnect ladder. On Windows, a failed direct probe
  returns a useful manual-pairing/port error without pretending automation ran.
- Acceptance: tests cover configured COM direct-open including persisted levels 1/2,
  missing configuration, USB/manual-SPP failure and unchanged Unix ladder decisions.

### 4. `ws/windows-port-enumerate` - list present COM candidates

Boundary: `apps/desktop/src-tauri/src/elm/transport/enumerate.rs`, its tests,
`apps/desktop/src-tauri/src/api/openapi.rs`, `README.md` and
`apps/desktop/docs/api.md`.

- Use `serialport::available_ports()` only on Windows. Never probe/open candidates.
- Return normalized `COMn` ids. Build the display name and `likely_obd` hint from
  the port name and available USB/Bluetooth metadata; retain every present port so
  a heuristic never hides the user's adapter.
- Put conversion and sorting behind a pure helper accepting synthetic port records;
  CI fixtures cover COM3, COM10+, USB, Bluetooth and unknown ports without assuming
  the hosted runner owns real devices.
- Preserve macOS/Linux discovery, filtering, ordering and path behavior while allowing
  the candidate DTO migration required by `adapter-ui-spec.md`.
- Correct docs: the HTTP API exists; the desktop Choose adapter UI does not yet.
- Acceptance: fixtures cover metadata, stable ordering and zero/multiple candidates;
  a live enumeration smoke is separate and non-gating.

### 5. Adapter UI gate

If gate 4 includes user-ready Windows, follow `adapter-ui-spec.md` after enumeration:
first the Tauri/schema/DeviceService/mock bridge, then the Connect -> Choose adapter
interaction. They are separate reviewed PRs and neither belongs to a transport
builder. If deferred, the Phase 2 handoff says "developer-configured Windows
transport."

## Verification and demonstration

- Every stream: inspect its exact diff; run uncached package tests plus Windows CI;
  record command output in the PR, not generated repository logs.
- After streams 1-4: on an authorized Windows machine, enumerate a real or approved
  virtual COM port and run a mock ELM responder through `ATZ`, `ATI` and prompt reads.
- Phase 3: USB adapter, manually paired SPP adapter and Wi-Fi adapter each complete
  connect -> poll -> SQLite -> DTC read -> UDS Lab on a real vehicle. Any DTC clear
  uses the existing confirmation and before/after audit; José performs the live gate.
- PR descriptions state exactly which adapter classes were proved and which remain
  untested. Alejandro/José merge each stream separately.
