# Research: Windows transport

Date: 2026-08-31. Base: `origin/main@c612e1b`.

## Scope and method

This research covers the Windows transport boundary, adapter discovery, connection
ladder, pre-hardware verification, licensing, and the minimum UI/CI needed to make a
Windows claim honest. Repository code is the primary evidence. External facts use
Microsoft documentation and the current Rust crate's own documentation/source.

## Verified repository facts

- `Transport` owns byte movement; `ElmDriver`, OBD and UDS sit above it. `TcpElm`
  uses `std::net::TcpStream` and has no platform branch. Assessment: the protocol
  core is already separated, so a Windows port should not rewrite it.
- `enumerate.rs` returns no Windows candidates. Its reusable helper filters only
  macOS/Linux names and always builds `/dev/{name}` ids. Windows needs a separate
  candidate source and COM-name normalization, not another glob.
- Enumeration is exposed by the local HTTP API (`GET /adapters`). No Tauri command
  or current frontend consumes it. `docs/product/ui-flow-spec.md` specifies a future
  Connect -> Choose adapter control, but that UI is not built. Assessment: backend
  serial support alone is developer-usable, not a user-ready Windows port.
- `elm_serial.rs` implements Unix raw termios only. Required parity is explicit:
  supported baud validation, 8 data bits, no parity/flow control, one stop bit,
  roughly 100 ms read waits, a 15 second bounded open, stale-input purge before
  every command, complete writes, output drain, and close-on-drop.
- The file records a real prior observation that a `serialport` crate configuration
  left Alejandro's classic-Bluetooth dongle mute. The repository does not preserve
  that old implementation or its exact settings. This is evidence to reproduce, not
  proof that the current crate fails on Windows.
- `supervisor.rs` treats `Path::exists(adapter.path)` as the direct-open gate. A COM
  name is not a filesystem path, so Windows would call the unsupported Bluetooth
  recovery path before trying an otherwise valid configured COM port. This is a
  fourth required behavior seam outside Claude's three transport files.
- A persisted learned Bluetooth level can also start at attempt 1 or 2 when
  `bt_addr` exists. A profile migrated from macOS must not carry that skip onto
  Windows; a configured COM port always needs a direct attempt first.
- The non-macOS Bluetooth control returns `manual pairing required`. Manual Windows
  SPP can work only when pairing has already exposed a COM port, its path is known,
  and the supervisor attempts it directly. Automatic cycle/re-pair is separate.
- Pull-request CI runs Rust only on Ubuntu. SCAINNER-03's Windows release job is
  tag/manual-triggered and independently unreviewed. It cannot prove each transport
  PR compiles and tests on Windows.

## External platform facts

- Microsoft requires serial `CreateFile` opens to use `OPEN_EXISTING`, exclusive
  share mode, and `\\.\COM10` syntax above COM9; the extended syntax works for every
  COM number. [CreateFile communications resources](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew#communications-resources)
- Windows serial settings inherit the previous open. Correct raw parity therefore
  requires `GetCommState` followed by explicit DCB changes and `SetCommState`.
  [Communications settings](https://learn.microsoft.com/en-us/windows/win32/devio/modification-of-communications-resource-settings)
- `COMMTIMEOUTS` controls `ReadFile`/`WriteFile`; `PurgeComm` discards driver input
  or output. These map to Scainner's short read and stale-input rules.
  [COMMTIMEOUTS](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-commtimeouts)
  and [communications functions](https://learn.microsoft.com/en-us/windows/win32/devio/communications-functions)
- `GetCommPorts` lists well-formed port numbers but starts at Windows 10 1803 and
  provides no device metadata. SetupAPI/Configuration Manager can enumerate present
  device interfaces and metadata without opening every port.
  [GetCommPorts](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getcommports)
  and [device-interface enumeration](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/enumerating-installed-device-interface-classes)
- Windows 11 includes Classic Bluetooth SPP/RFCOMM. Direct RFCOMM sockets are a
  distinct transport, not required to open an already-created COM port.
  [Windows Bluetooth profile support](https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/general-bluetooth-support-in-windows)
- `serialport` 4.10.0, checked 2026-08-31, provides blocking Windows `COMPort`,
  SetupAPI enumeration, COM10+ normalization, explicit 8N1/no-flow settings, full writes,
  `FlushFileBuffers`, and input/output `PurgeComm`. Its Windows dependency is
  target-gated `windows-sys`. It is MPL-2.0 and the project is seeking maintainers,
  especially for Windows.
  [4.10.0 metadata](https://docs.rs/crate/serialport/4.10.0),
  [Windows source](https://github.com/serialport/serialport-rs/blob/v4.10.0/src/windows/com.rs),
  [enumerator source](https://github.com/serialport/serialport-rs/blob/v4.10.0/src/windows/enumerate.rs)
- The crate deliberately stopped asserting DTR automatically after device reports
  showed that behavior caused failures. Scainner's target dongle requirement is
  unknown and belongs in the mandatory Windows I/O proof.
  [4.10.0 changelog](https://github.com/serialport/serialport-rs/blob/v4.10.0/CHANGELOG.md)
- MPL permits a larger proprietary work, but distributed executables must tell
  recipients where to obtain the MPL-covered source. The release notice/SBOM gate
  must cover the crate. [Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- Tauri 2 can bundle a notice as an installer resource through `bundle.resources`.
  [Tauri configuration reference](https://v2.tauri.app/reference/config/#resources)

## Viable serial approaches

### A. Raw WinAPI through `windows-sys`

Implement `CreateFileW`, DCB, COMMTIMEOUTS, `PurgeComm`, `ReadFile`, `WriteFile`,
`FlushFileBuffers` and handle lifetime directly; use `GetCommPorts` or SetupAPI for
enumeration. This gives exact control and no MPL dependency. Trade-off: Scainner
would own substantial unsafe platform code, metadata enumeration, error mapping and
edge cases already handled by a specialist crate. SetupAPI makes this much larger
than the current Unix termios implementation.

### B. `serialport` only under `cfg(windows)`

Keep the proven Unix termios implementation unchanged. On Windows use the crate for
COM open/configuration, enumeration and metadata; adapt `TimedOut` reads to zero-byte
polls, call `clear(Input)` before each command, use `write_all` plus `flush`, and keep
Scainner's outer 15 second open deadline. Trade-off: one MPL dependency, a project
seeking Windows maintainers, and hardware-specific settings still require proof.

**Recommendation:** B. It minimizes new unsafe code and solves enumeration plus I/O
without risking the proven macOS/Linux path. The prior mute-dongle observation makes
configuration parity and hardware validation mandatory, but does not justify owning
a second serial library inside Scainner. Pin the reviewed 4.10.0 release.

## Recommended v1 scope

- Keep Wi-Fi `tcp_elm` unchanged.
- Add USB serial and manually paired Classic Bluetooth SPP through Windows COM ports.
- Defer automatic Windows Bluetooth cycle/re-pair and direct RFCOMM sockets.
- Add a real adapter-selection UI stream before calling the port user-ready. Until
  that lands, document the API/environment setup as developer validation only.
- Validate on Windows 11 first. Decide at the human gate whether Windows 10 is a
  supported product target or only best-effort compatibility.

## Verification before and after hardware

1. Add PR-triggered Windows Rust CI before transport work; run format separately,
   then `cargo check`, Clippy where stable, and a real `cargo test --locked`.
2. Unit-test candidate normalization, COM10+, timeout-to-empty-read mapping, stale
   input purge calls, partial-write completion and connection-ladder decisions.
3. Do not install an unaudited virtual serial kernel driver in CI. The original
   com0com release is old and modern Windows signing is problematic; third-party
   signature patches are not an acceptable default. Before serial implementation,
   the human gate must name an authorized Windows machine and verified virtual or
   physical serial pair. Its mock ELM proof is mandatory; without it Phase 2 I/O
   remains incomplete, even when CI is green.
4. Phase 3 still requires the real USB and Bluetooth adapters: connect, AT handshake,
   polling, SQLite recording, DTC operations and UDS flow. Virtual I/O cannot prove
   pairing, clone timing or sulk-mode recovery.

## Deliberately not investigated

- BLE adapters, automatic Windows pairing/re-pair, direct RFCOMM, ARM64 Windows,
  installer correctness, and vehicle protocol changes. They do not decide the v1
  serial boundary. SCAINNER-03's release diff remains its own formal review task.
