use super::{read_until_prompt, Transport, TransportInfo};
use crate::elm::driver::ElmError;
#[cfg(unix)]
use std::os::unix::io::RawFd;
#[cfg(unix)]
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

pub const SUPPORTED_BAUDS: [u32; 6] = [9600, 19200, 38400, 57600, 115_200, 230_400];

pub const OPEN_TIMEOUT: Duration = Duration::from_secs(10);

pub const BLUETOOTH_OPEN_TIMEOUT: Duration = Duration::from_secs(20);

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

// SAFETY: the owned fd is accessed only by the supervisor thread.
unsafe impl Send for ElmSerial {}

#[cfg(unix)]
enum Handoff {
    Pending,
    Done(Result<RawFd, String>),
    GaveUp,
}

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
            // A late descriptor is closed because leaking it keeps the callout device busy until restart.
            if let Ok(fd) = opened {
                if fd >= 0 {
                    // SAFETY: fd is an unclaimed descriptor returned by libc::open.
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
        _ => Err(ElmError::Open(format!(
            "blocking open timed out after {}s",
            timeout.as_secs()
        ))),
    }
}

impl ElmSerial {
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
            // SAFETY: c is a valid NUL-terminated path and the returned fd is checked.
            let fd = unsafe { libc::open(c.as_ptr(), libc::O_RDWR | libc::O_NOCTTY) };
            if fd < 0 {
                return Err(format!(
                    "open {path_owned}: {}",
                    std::io::Error::last_os_error()
                ));
            }
            Ok(fd)
        })?;
        // SAFETY: fd is owned here; every libc result is checked before use.
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
            // termios VTIME is measured in deciseconds.
            t.c_cc[libc::VTIME] = 1;
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
        // SAFETY: fd is valid and owned by self for the duration of this call.
        unsafe { libc::tcflush(fd, libc::TCIFLUSH) };
        let msg = format!("{c}\r");
        let bytes = msg.as_bytes();
        let mut written = 0usize;
        while written < bytes.len() {
            // SAFETY: fd is valid and bytes exposes a live buffer of the supplied length.
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
        // SAFETY: fd is valid and owned by self.
        unsafe { libc::tcdrain(fd) };
        read_until_prompt(timeout, |chunk| {
            // SAFETY: chunk is writable for chunk.len() bytes and fd is valid.
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
            // SAFETY: fd is owned by self and is invalidated immediately after closing.
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
        assert_eq!(open_timeout("/dev/cu.usbserial-10", None), OPEN_TIMEOUT);
        assert_eq!(open_timeout("/dev/cu.OBDII", Some("  ")), OPEN_TIMEOUT);
        assert_eq!(
            open_timeout("/dev/ttyUSB0", Some("aa-bb-cc-dd-ee-ff")),
            OPEN_TIMEOUT
        );
    }

    fn saw_eof(fd: libc::c_int) -> bool {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut buf = [0u8; 1];
        while std::time::Instant::now() < deadline {
            // SAFETY: buf is writable for one byte and the test owns fd.
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
        // SAFETY: fds provides storage for the two descriptors written by pipe.
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        let (read_end, write_end) = (fds[0], fds[1]);
        // SAFETY: read_end is the valid descriptor returned by pipe.
        unsafe { libc::fcntl(read_end, libc::F_SETFL, libc::O_NONBLOCK) };

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
        // SAFETY: the test owns read_end and closes it exactly once.
        unsafe { libc::close(read_end) };
    }

    #[test]
    fn an_open_that_lands_in_time_hands_the_fd_to_the_waiter() {
        let path = std::ffi::CString::new("/dev/null").unwrap();
        let fd = open_fd_with_timeout(Duration::from_secs(5), move || {
            // SAFETY: path is NUL-terminated and the returned fd is checked.
            let fd = unsafe { libc::open(path.as_ptr(), libc::O_RDWR) };
            if fd < 0 {
                return Err("open failed".into());
            }
            Ok(fd)
        })
        .expect("a prompt open should hand its fd over");
        assert!(fd >= 0);
        // SAFETY: fd is valid until the close below.
        assert!(
            unsafe { libc::fcntl(fd, libc::F_GETFD) } >= 0,
            "the waiter's fd must still be open"
        );
        // SAFETY: the test owns fd and closes it exactly once.
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
