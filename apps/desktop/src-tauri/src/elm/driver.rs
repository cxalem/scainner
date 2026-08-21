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
    fd: RawFd,
}

// The fd is only touched from the supervisor thread.
unsafe impl Send for ElmDriver {}

impl Drop for ElmDriver {
    fn drop(&mut self) {
        unsafe { libc::close(self.fd) };
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
        Ok(Self { fd })
    }

    /// Send a command, read until the ELM `>` prompt or timeout.
    pub fn cmd(&mut self, c: &str, timeout: Duration) -> Result<String, ElmError> {
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
        unsafe { libc::tcflush(self.fd, libc::TCIFLUSH) };
        let msg = format!("{c}\r");
        let bytes = msg.as_bytes();
        let mut written = 0usize;
        while written < bytes.len() {
            let n = unsafe {
                libc::write(
                    self.fd,
                    bytes[written..].as_ptr() as *const libc::c_void,
                    bytes.len() - written,
                )
            };
            if n < 0 {
                return Err(ElmError::Io(std::io::Error::last_os_error().to_string()));
            }
            written += n as usize;
        }
        unsafe { libc::tcdrain(self.fd) };

        let mut buf: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 256];
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            let n = unsafe {
                libc::read(self.fd, chunk.as_mut_ptr() as *mut libc::c_void, chunk.len())
            };
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
        let version = version.ok_or_else(|| ElmError::Handshake("no ELM banner after ATZ".into()))?;
        self.cmd("ATE0", Duration::from_secs(3))?;
        self.cmd("ATSP0", Duration::from_secs(3))?;
        Ok(version)
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
    log::trace!("blueutil --disconnect: {:?}", disc.as_ref().map(|o| o.status.code()));
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
    log::debug!("blueutil --connect (post-pair): {:?}", conn.map(|o| o.status.code()));
    for _ in 0..15 {
        if std::path::Path::new(&port()).exists() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    // Port node sometimes needs one extra cycle after a re-pair.
    bluetooth_cycle(addr)
}
