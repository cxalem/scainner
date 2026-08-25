//! Serial driver for the vGate iCar Pro (classic-BT variant) on macOS.
//!
//! Empirically established 2026-08-14 with the real dongle:
//! - Device pairs as "V-LINK" (10:21:3E:4F:E8:C1) with PIN 1234. The PIN is
//!   **not standardized** across ELM327 clones — it's whatever the
//!   manufacturer's Bluetooth module firmware happens to expect, and `1234`
//!   is only the most common one (~90% of clones), not universal. Override
//!   with `SCAINNER_OBD_PIN` if pairing fails; see the README's "Hardware"
//!   section for the short list of common alternatives worth trying.
//! - Port appears at /dev/cu.V-LINK.
//! - The RFCOMM link drops when the port closes; a
//!   `blueutil --disconnect && blueutil --connect` cycle revives it, and
//!   also recreates the port node if it vanished after an unpair.
//!
//! The port is opened with raw libc + termios, mirroring byte-for-byte the
//! python setup that provably talked to the dongle (the `serialport` crate's
//! configuration left the dongle mute): blocking O_RDWR|O_NOCTTY open,
//! iflag/oflag/lflag = 0, cflag = CREAD|CLOCAL|CS8, B115200, VMIN=0 VTIME=1.

use std::ffi::CString;
use std::os::unix::io::RawFd;
use std::process::Command;
use std::time::{Duration, Instant};

#[cfg(test)]
use serde::Deserialize;

// Defaults match the author's own vGate iCar Pro — override via env vars for
// any other dongle/pairing. `port()` and `bt_addr()` are the functions
// everything else in this module and `supervisor.rs` actually call; the
// consts below only exist as their fallback values.
const DEFAULT_PORT: &str = "/dev/cu.V-LINK";
const DEFAULT_BT_ADDR: &str = "10-21-3e-4f-e8-c1";

/// Serial port device path. Override with `SCAINNER_OBD_PORT` if your
/// dongle enumerates under a different name (check `ls /dev/cu.*` after
/// pairing).
pub fn port() -> String {
    std::env::var("SCAINNER_OBD_PORT").unwrap_or_else(|_| DEFAULT_PORT.to_string())
}

/// Bluetooth MAC address (blueutil's dashed format, e.g. `aa-bb-cc-dd-ee-ff`)
/// of the paired dongle. Override with `SCAINNER_OBD_MAC` — every dongle has
/// a different address, so this almost certainly needs setting for hardware
/// other than the author's.
pub fn bt_addr() -> String {
    std::env::var("SCAINNER_OBD_MAC").unwrap_or_else(|_| DEFAULT_BT_ADDR.to_string())
}

#[derive(Debug, thiserror::Error)]
pub enum ElmError {
    #[error("open failed: {0}")]
    Open(String),
    #[error("io: {0}")]
    Io(String),
    #[error("no response from ELM (link down?)")]
    NoResponse,
    #[error("handshake failed: {0}")]
    Handshake(String),
}

pub struct ElmDriver {
    backend: Backend,
}

enum Backend {
    Serial(RawFd),
    #[cfg(test)]
    Replay(ReplayBackend),
}

// The fd is only touched from the supervisor thread.
unsafe impl Send for ElmDriver {}

impl Drop for ElmDriver {
    fn drop(&mut self) {
        match &self.backend {
            Backend::Serial(fd) => unsafe {
                libc::close(*fd);
            },
            #[cfg(test)]
            Backend::Replay(_) => {}
        }
    }
}

impl ElmDriver {
    /// Blocking open (forces the BT link up), run on a helper thread with a
    /// timeout so a wedged link can't hang the supervisor forever.
    pub fn open(path: &str) -> Result<Self, ElmError> {
        let path_owned = path.to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let c = CString::new(path_owned).unwrap();
            let fd = unsafe { libc::open(c.as_ptr(), libc::O_RDWR | libc::O_NOCTTY) };
            let _ = tx.send(fd);
        });
        let fd = rx
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| ElmError::Open("blocking open timed out after 15s".into()))?;
        if fd < 0 {
            return Err(ElmError::Open(format!(
                "errno {}",
                std::io::Error::last_os_error()
            )));
        }

        // Exact termios config from the proven python session.
        unsafe {
            let mut t: libc::termios = std::mem::zeroed();
            if libc::tcgetattr(fd, &mut t) != 0 {
                libc::close(fd);
                return Err(ElmError::Open("tcgetattr failed".into()));
            }
            t.c_iflag = 0;
            t.c_oflag = 0;
            t.c_lflag = 0;
            t.c_cflag = libc::CREAD | libc::CLOCAL | libc::CS8;
            t.c_cc[libc::VMIN] = 0;
            t.c_cc[libc::VTIME] = 1; // 100 ms read timeout per read()
            libc::cfsetispeed(&mut t, libc::B115200);
            libc::cfsetospeed(&mut t, libc::B115200);
            if libc::tcsetattr(fd, libc::TCSANOW, &t) != 0 {
                libc::close(fd);
                return Err(ElmError::Open("tcsetattr failed".into()));
            }
            libc::tcflush(fd, libc::TCIOFLUSH);
        }
        Ok(Self {
            backend: Backend::Serial(fd),
        })
    }

    /// Send a command, read until the ELM `>` prompt or timeout.
    pub fn cmd(&mut self, c: &str, timeout: Duration) -> Result<String, ElmError> {
        #[cfg(test)]
        if let Backend::Replay(replay) = &mut self.backend {
            return replay.cmd(c, timeout);
        }

        let fd = match &self.backend {
            Backend::Serial(fd) => *fd,
            #[cfg(test)]
            Backend::Replay(_) => unreachable!("the replay backend is handled above"),
        };
        // Discard anything already sitting unread in the input buffer before
        // writing — a previous command whose response arrived after this
        // struct's own deadline gave up on it (still returned Ok/Err, but
        // its late bytes never got read) leaves stale data in the OS's
        // serial buffer; without this flush, those bytes get read as part
        // of THIS command's response, misattributing one PID's leftover
        // answer to a completely different one. Caught live on a real
        // Peugeot (2026-08-21) — a slower-responding ECU than the Citroën
        // this driver was built and tested against makes the timing window
        // for this real, not just theoretical. See parser.rs's
        // payload_bytes for the matching fix on the decode side (a response
        // that doesn't match its expected prefix — including a stale one
        // from a prior command — now yields no reading instead of a wrong
        // one, rather than relying on this flush alone).
        unsafe { libc::tcflush(fd, libc::TCIFLUSH) };
        let msg = format!("{c}\r");
        let bytes = msg.as_bytes();
        let mut written = 0usize;
        while written < bytes.len() {
            let n = unsafe {
                libc::write(
                    fd,
                    bytes[written..].as_ptr() as *const libc::c_void,
                    bytes.len() - written,
                )
            };
            if n < 0 {
                return Err(ElmError::Io(std::io::Error::last_os_error().to_string()));
            }
            written += n as usize;
        }
        unsafe { libc::tcdrain(fd) };

        let mut buf: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 256];
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            let n = unsafe { libc::read(fd, chunk.as_mut_ptr() as *mut libc::c_void, chunk.len()) };
            if n < 0 {
                return Err(ElmError::Io(std::io::Error::last_os_error().to_string()));
            }
            if n > 0 {
                buf.extend_from_slice(&chunk[..n as usize]);
                if buf.contains(&b'>') {
                    break;
                }
            } else {
                // VTIME already blocked ~100ms; small extra breather.
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        if buf.is_empty() {
            return Err(ElmError::NoResponse);
        }
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }

    #[cfg(test)]
    pub fn from_replay_json(raw: &str) -> Result<Self, String> {
        let fixture: ReplayFixture = serde_json::from_str(raw)
            .map_err(|error| format!("invalid replay fixture: {error}"))?;
        if fixture.schema_version != 1 {
            return Err(format!(
                "unsupported replay schema version {}",
                fixture.schema_version
            ));
        }
        if fixture.contains_vehicle_identifiers {
            return Err("replay fixtures must not contain vehicle identifiers".into());
        }
        if fixture.steps.is_empty() {
            return Err("replay fixture has no steps".into());
        }
        Ok(Self {
            backend: Backend::Replay(ReplayBackend {
                name: fixture.name,
                steps: fixture.steps.into(),
                observed: Vec::new(),
            }),
        })
    }

    #[cfg(test)]
    pub fn assert_replay_complete(&self) {
        let Backend::Replay(replay) = &self.backend else {
            panic!("assert_replay_complete called on a serial driver")
        };
        assert!(
            replay.steps.is_empty(),
            "replay {:?} ended with {} unconsumed steps after commands {:?}",
            replay.name,
            replay.steps.len(),
            replay.observed
        );
    }

    /// ATZ (retried) → ATE0 → ATSP0. Returns the ELM version string.
    pub fn init(&mut self) -> Result<String, ElmError> {
        let mut version = None;
        for _ in 0..5 {
            match self.cmd("ATZ", Duration::from_secs(6)) {
                Ok(r) if r.contains("ELM") => {
                    version = Some(
                        r.lines()
                            .map(str::trim)
                            .find(|l| l.contains("ELM"))
                            .unwrap_or("ELM327")
                            .to_string(),
                    );
                    break;
                }
                _ => std::thread::sleep(Duration::from_millis(800)),
            }
        }
        let version =
            version.ok_or_else(|| ElmError::Handshake("no ELM banner after ATZ".into()))?;
        self.cmd("ATE0", Duration::from_secs(3))?;
        self.cmd("ATSP0", Duration::from_secs(3))?;
        Ok(version)
    }
}

#[cfg(test)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReplayFixture {
    schema_version: u32,
    name: String,
    /// A fixture is rejected unless its author explicitly confirms that VINs,
    /// ECU serials, registration numbers, and adapter MACs were removed.
    contains_vehicle_identifiers: bool,
    steps: Vec<ReplayStep>,
}

#[cfg(test)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReplayStep {
    command: String,
    #[serde(default)]
    response: Option<String>,
    #[serde(default)]
    error: Option<ReplayError>,
    #[serde(default)]
    minimum_timeout_ms: Option<u64>,
}

#[cfg(test)]
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ReplayError {
    NoResponse,
    Io,
    Handshake,
}

#[cfg(test)]
struct ReplayBackend {
    name: String,
    steps: std::collections::VecDeque<ReplayStep>,
    observed: Vec<String>,
}

#[cfg(test)]
impl ReplayBackend {
    fn cmd(&mut self, command: &str, timeout: Duration) -> Result<String, ElmError> {
        self.observed.push(command.to_string());
        let Some(step) = self.steps.pop_front() else {
            return Err(ElmError::Handshake(format!(
                "replay {:?} received unexpected command {command:?}",
                self.name
            )));
        };
        if step.command != command {
            return Err(ElmError::Handshake(format!(
                "replay {:?} expected command {:?}, got {command:?}",
                self.name, step.command
            )));
        }
        if let Some(minimum) = step.minimum_timeout_ms {
            if timeout < Duration::from_millis(minimum) {
                return Err(ElmError::Handshake(format!(
                    "replay {:?} command {command:?} requires at least {minimum}ms, got {}ms",
                    self.name,
                    timeout.as_millis()
                )));
            }
        }
        match (step.response, step.error) {
            (Some(response), None) => Ok(response),
            (None, Some(ReplayError::NoResponse)) => Err(ElmError::NoResponse),
            (None, Some(ReplayError::Io)) => Err(ElmError::Io("replayed I/O failure".into())),
            (None, Some(ReplayError::Handshake)) => {
                Err(ElmError::Handshake("replayed handshake failure".into()))
            }
            _ => Err(ElmError::Handshake(format!(
                "replay {:?} step {command:?} must define exactly one of response or error",
                self.name
            ))),
        }
    }
}

fn blueutil() -> Command {
    // Homebrew path first; fall back to PATH.
    let path = if std::path::Path::new("/opt/homebrew/bin/blueutil").exists() {
        "/opt/homebrew/bin/blueutil"
    } else {
        "blueutil"
    };
    Command::new(path)
}

/// Disconnect/connect cycle that revives the RFCOMM link and recreates
/// the /dev/cu.V-LINK node. Safe to call when already disconnected.
pub fn bluetooth_cycle(addr: &str) -> Result<(), String> {
    let disc = blueutil().args(["--disconnect", addr]).output();
    log::trace!(
        "blueutil --disconnect: {:?}",
        disc.as_ref().map(|o| o.status.code())
    );
    std::thread::sleep(Duration::from_secs(1));
    let out = blueutil()
        .args(["--connect", addr])
        .output()
        .map_err(|e| format!("blueutil not runnable: {e}"))?;
    log::trace!(
        "blueutil --connect: code={:?} stderr={}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr).trim()
    );
    if !out.status.success() {
        return Err(format!(
            "blueutil --connect failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    // Give macOS a moment to (re)create the serial node.
    for _ in 0..10 {
        if std::path::Path::new(&port()).exists() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err("serial port did not appear after connect".into())
}

/// Nuclear option (proven the ONLY reliable revival 2026-08-14): the dongle
/// periodically stops answering on an existing pairing and only a fresh
/// PIN pairing wakes it. unpair → pair PIN 1234 → connect → wait for port.
pub fn bluetooth_repair(addr: &str, pin: &str) -> Result<(), String> {
    let un = blueutil().args(["--unpair", addr]).output();
    log::debug!("blueutil --unpair: {:?}", un.map(|o| o.status.code()));
    std::thread::sleep(Duration::from_secs(2));
    let pair = blueutil()
        .args(["--pair", addr, pin])
        .output()
        .map_err(|e| format!("blueutil not runnable: {e}"))?;
    log::debug!(
        "blueutil --pair: code={:?} stderr={}",
        pair.status.code(),
        String::from_utf8_lossy(&pair.stderr).trim()
    );
    if !pair.status.success() {
        return Err("PIN pairing failed — is the dongle powered?".into());
    }
    std::thread::sleep(Duration::from_secs(1));
    let conn = blueutil().args(["--connect", addr]).output();
    log::debug!(
        "blueutil --connect (post-pair): {:?}",
        conn.map(|o| o.status.code())
    );
    for _ in 0..15 {
        if std::path::Path::new(&port()).exists() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    // Port node sometimes needs one extra cycle after a re-pair.
    bluetooth_cycle(addr)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRANSPORT_FAILURES: &str =
        include_str!("../../tests/fixtures/elm/transport-failures.json");

    #[test]
    fn replay_preserves_transport_failure_categories_and_time_requirements() {
        let mut driver = ElmDriver::from_replay_json(TRANSPORT_FAILURES).unwrap();

        assert!(matches!(
            driver.cmd("NO_RESPONSE", Duration::from_secs(1)),
            Err(ElmError::NoResponse)
        ));
        assert!(matches!(
            driver.cmd("IO_FAILURE", Duration::from_secs(1)),
            Err(ElmError::Io(_))
        ));
        assert!(matches!(
            driver.cmd("HANDSHAKE_FAILURE", Duration::from_secs(1)),
            Err(ElmError::Handshake(_))
        ));
        assert!(matches!(
            driver.cmd("SLOW_RESPONSE", Duration::from_millis(999)),
            Err(ElmError::Handshake(_))
        ));
        driver.assert_replay_complete();
    }

    #[test]
    fn replay_rejects_out_of_order_commands() {
        let raw = r#"{
            "schema_version": 1,
            "name": "ordered",
            "contains_vehicle_identifiers": false,
            "steps": [{"command": "0101", "response": "41 01 00 00 00 00\\r>"}]
        }"#;
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();
        let error = driver
            .cmd("03", Duration::from_secs(1))
            .expect_err("the wrong command must fail");
        assert!(error.to_string().contains("expected command"));
    }

    #[test]
    fn replay_rejects_unreviewed_vehicle_identifiers() {
        let raw = r#"{
            "schema_version": 1,
            "name": "unsafe capture",
            "contains_vehicle_identifiers": true,
            "steps": [{"command": "0902", "response": "REDACT ME"}]
        }"#;
        let error = ElmDriver::from_replay_json(raw)
            .err()
            .expect("privacy-marked fixture must be rejected");
        assert!(error.contains("vehicle identifiers"));
    }
}
