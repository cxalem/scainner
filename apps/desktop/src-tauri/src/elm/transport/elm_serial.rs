//! Serial transport (Bluetooth SPP or USB) via raw libc + termios.
//!
//! Mirrors byte-for-byte the python setup that provably talked to a classic
//! Bluetooth dongle (the `serialport` crate's configuration left it mute):
//! blocking O_RDWR|O_NOCTTY open, iflag/oflag/lflag = 0, cflag =
//! CREAD|CLOCAL|CS8, VMIN=0 VTIME=1 (100 ms per read).

use super::{read_until_prompt, Transport, TransportInfo};
use crate::elm::driver::ElmError;
#[cfg(unix)]
use std::os::unix::io::RawFd;
#[cfg(unix)]
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// The baud rates the termios path can set. `AdapterProfile::validate`
/// rejects anything else so a bad setting fails at `PUT /adapter`, not at
/// connect time.
pub const SUPPORTED_BAUDS: [u32; 6] = [9600, 19200, 38400, 57600, 115_200, 230_400];

/// The connect pipeline's Open budget for a wired or network-backed node.
/// A USB node opens instantly, so anything past this is a wedged device,
/// not a slow one.
pub const OPEN_TIMEOUT: Duration = Duration::from_secs(10);

/// The Open budget for a Bluetooth serial node, which blocks until macOS
/// has the RFCOMM link up. The Link stage has usually woken the radio
/// already; this is what a link that was up but idle needs.
pub const BLUETOOTH_OPEN_TIMEOUT: Duration = Duration::from_secs(20);

/// Which budget one open gets: the longer one only for a Bluetooth serial
/// node — a `cu.` callout device with a Bluetooth address in the profile.
pub fn open_timeout(path: &str, bt_addr: Option<&str>) -> Duration {
    let bluetooth = path.contains("cu.") && bt_addr.is_some_and(|a| !a.trim().is_empty());
    if bluetooth {
        BLUETOOTH_OPEN_TIMEOUT
    } else {
        OPEN_TIMEOUT
    }
}

pub struct ElmSerial {
    #[cfg(unix)]
    fd: std::os::unix::io::RawFd,
    path: String,
}

// The fd is only touched from the supervisor thread.
unsafe impl Send for ElmSerial {}

/// The waiter/opener handoff for the timed open below.
#[cfg(unix)]
enum Handoff {
    Pending,
    Done(Result<RawFd, String>),
    /// The waiter timed out and returned; whatever the opener produces now
    /// belongs to nobody and must be closed by the opener thread.
    GaveUp,
}

/// Run `opener` (a blocking `libc::open`) on a helper thread and wait
/// `timeout` for it.
///
/// The subtle part is the losing race: `libc::open` on a `/dev/cu.*`
/// callout device can finish long after the waiter gave up, and the fd it
/// produces has to be closed by *someone*. Leaking it kept the callout
/// device busy for the life of the process — every later connect then
/// failed with EBUSY until the app was restarted (the bug this function
/// exists to prevent). The mutex makes the handover atomic: the opener
/// either publishes the fd to a waiter that is still there, or sees
/// `GaveUp` and closes it itself.
#[cfg(unix)]
fn open_fd_with_timeout<F>(timeout: Duration, opener: F) -> Result<RawFd, ElmError>
where
    F: FnOnce() -> Result<RawFd, String> + Send + 'static,
{
    let shared = Arc::new((Mutex::new(Handoff::Pending), Condvar::new()));
    let worker = Arc::clone(&shared);
    std::thread::spawn(move || {
        let opened = opener();
        let (lock, cvar) = &*worker;
        let mut state = lock.lock().unwrap_or_else(|e| e.into_inner());
        if matches!(*state, Handoff::GaveUp) {
            if let Ok(fd) = opened {
                if fd >= 0 {
                    unsafe { libc::close(fd) };
                }
                log::warn!("serial open finished after the wait timed out; closed the orphaned fd so the callout device stays usable");
            }
        } else {
            *state = Handoff::Done(opened);
            cvar.notify_all();
        }
    });
    let (lock, cvar) = &*shared;
    let guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let (mut guard, _) = cvar
        .wait_timeout_while(guard, timeout, |s| matches!(s, Handoff::Pending))
        .unwrap_or_else(|e| e.into_inner());
    match std::mem::replace(&mut *guard, Handoff::GaveUp) {
        Handoff::Done(result) => result.map_err(ElmError::Open),
        // `replace` left `GaveUp` behind, which is exactly what the opener
        // thread has to see.
        _ => Err(ElmError::Open(format!(
            "blocking open timed out after {}s",
            timeout.as_secs()
        ))),
    }
}

impl ElmSerial {
    /// Blocking open (a Bluetooth port forces the link up), run on a helper
    /// thread with a timeout so a wedged link can't hang the supervisor.
    #[cfg(unix)]
    pub fn open(path: &str, baud: u32, bt_addr: Option<&str>) -> Result<Self, ElmError> {
        let speed = baud_constant(baud).ok_or_else(|| {
            ElmError::Open(format!(
                "unsupported baud rate {baud} (supported: {SUPPORTED_BAUDS:?})"
            ))
        })?;
        let path_owned = path.to_string();
        let c = std::ffi::CString::new(path_owned.clone())
            .map_err(|_| ElmError::Open(format!("invalid serial path {path_owned}")))?;
        let fd = open_fd_with_timeout(open_timeout(path, bt_addr), move || {
            let fd = unsafe { libc::open(c.as_ptr(), libc::O_RDWR | libc::O_NOCTTY) };
            if fd < 0 {
                // errno belongs to *this* thread — reading it from the
                // waiter would report an unrelated error.
                return Err(format!(
                    "open {path_owned}: {}",
                    std::io::Error::last_os_error()
                ));
            }
            Ok(fd)
        })?;
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
            libc::cfsetispeed(&mut t, speed);
            libc::cfsetospeed(&mut t, speed);
            if libc::tcsetattr(fd, libc::TCSANOW, &t) != 0 {
                libc::close(fd);
                return Err(ElmError::Open("tcsetattr failed".into()));
            }
            libc::tcflush(fd, libc::TCIOFLUSH);
        }
        Ok(Self {
            fd,
            path: path.to_string(),
        })
    }

    #[cfg(not(unix))]
    pub fn open(path: &str, _baud: u32, _bt_addr: Option<&str>) -> Result<Self, ElmError> {
        Err(ElmError::Open(format!(
            "serial port {path}: the serial transport is not implemented on this platform yet; use a tcp_elm adapter"
        )))
    }
}

#[cfg(unix)]
fn baud_constant(baud: u32) -> Option<libc::speed_t> {
    Some(match baud {
        9600 => libc::B9600,
        19200 => libc::B19200,
        38400 => libc::B38400,
        57600 => libc::B57600,
        115200 => libc::B115200,
        230400 => libc::B230400,
        _ => return None,
    })
}

impl Transport for ElmSerial {
    #[cfg(unix)]
    fn cmd(&mut self, c: &str, timeout: Duration) -> Result<String, ElmError> {
        let fd = self.fd;
        // Discard anything already sitting unread in the input buffer before
        // writing — a previous command whose response arrived after the
        // driver's own deadline gave up on it leaves stale data in the OS's
        // serial buffer; without this flush, those bytes get read as part
        // of THIS command's response, misattributing one PID's leftover
        // answer to a completely different one. Caught live on a slower ECU
        // (2026-08-21). See parser.rs's payload_bytes for the decode-side
        // half of the fix.
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
        read_until_prompt(timeout, |chunk| {
            let n = unsafe { libc::read(fd, chunk.as_mut_ptr() as *mut libc::c_void, chunk.len()) };
            if n < 0 {
                Err(std::io::Error::last_os_error().to_string())
            } else {
                Ok(n as usize)
            }
        })
    }

    #[cfg(not(unix))]
    fn cmd(&mut self, _c: &str, _timeout: Duration) -> Result<String, ElmError> {
        Err(ElmError::Io(
            "serial transport unavailable on this platform".into(),
        ))
    }

    fn close(&mut self) {
        #[cfg(unix)]
        if self.fd >= 0 {
            unsafe {
                libc::close(self.fd);
            }
            self.fd = -1;
        }
    }

    fn describe(&self) -> TransportInfo {
        TransportInfo {
            kind: "elm_serial".into(),
            target: self.path.clone(),
            banner: None,
        }
    }
}

impl Drop for ElmSerial {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn only_a_bluetooth_serial_node_gets_the_longer_open_budget() {
        assert_eq!(
            open_timeout("/dev/cu.OBDII", Some("aa-bb-cc-dd-ee-ff")),
            BLUETOOTH_OPEN_TIMEOUT
        );
        // A callout node with no Bluetooth address is a USB adapter.
        assert_eq!(open_timeout("/dev/cu.usbserial-10", None), OPEN_TIMEOUT);
        assert_eq!(open_timeout("/dev/cu.OBDII", Some("  ")), OPEN_TIMEOUT);
        assert_eq!(
            open_timeout("/dev/ttyUSB0", Some("aa-bb-cc-dd-ee-ff")),
            OPEN_TIMEOUT
        );
    }

    /// Reading a pipe's read end reports EOF only once *every* write end is
    /// closed, so this proves the orphaned descriptor was really closed
    /// rather than merely dropped from view.
    fn saw_eof(fd: libc::c_int) -> bool {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut buf = [0u8; 1];
        while std::time::Instant::now() < deadline {
            let n = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, 1) };
            if n == 0 {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    #[test]
    fn an_open_that_lands_after_the_timeout_closes_its_own_fd() {
        let mut fds = [0 as libc::c_int; 2];
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        let (read_end, write_end) = (fds[0], fds[1]);
        // Non-blocking, so the assertion below can never hang the suite.
        unsafe { libc::fcntl(read_end, libc::F_SETFL, libc::O_NONBLOCK) };

        // The write end stands in for the port fd a late `libc::open`
        // hands back once macOS has finally brought the link up.
        let err = open_fd_with_timeout(Duration::from_millis(50), move || {
            std::thread::sleep(Duration::from_millis(300));
            Ok(write_end)
        })
        .unwrap_err();
        assert!(err.to_string().contains("timed out"), "{err}");

        assert!(
            saw_eof(read_end),
            "the abandoned fd was never closed — the callout device would stay busy"
        );
        unsafe { libc::close(read_end) };
    }

    #[test]
    fn an_open_that_lands_in_time_hands_the_fd_to_the_waiter() {
        let path = std::ffi::CString::new("/dev/null").unwrap();
        let fd = open_fd_with_timeout(Duration::from_secs(5), move || {
            let fd = unsafe { libc::open(path.as_ptr(), libc::O_RDWR) };
            if fd < 0 {
                return Err("open failed".into());
            }
            Ok(fd)
        })
        .expect("a prompt open should hand its fd over");
        assert!(fd >= 0);
        assert!(
            unsafe { libc::fcntl(fd, libc::F_GETFD) } >= 0,
            "the waiter's fd must still be open"
        );
        unsafe { libc::close(fd) };
    }

    #[test]
    fn an_open_that_fails_reports_the_openers_own_error() {
        let err = open_fd_with_timeout(Duration::from_secs(5), || Err("errno 16".into()))
            .unwrap_err()
            .to_string();
        assert!(err.contains("errno 16"), "{err}");
    }
}
