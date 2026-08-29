//! Serial transport (Bluetooth SPP or USB) via raw libc + termios.
//!
//! Mirrors byte-for-byte the python setup that provably talked to a classic
//! Bluetooth dongle (the `serialport` crate's configuration left it mute):
//! blocking O_RDWR|O_NOCTTY open, iflag/oflag/lflag = 0, cflag =
//! CREAD|CLOCAL|CS8, VMIN=0 VTIME=1 (100 ms per read).

use super::{read_until_prompt, Transport, TransportInfo};
use crate::elm::driver::ElmError;
use std::time::Duration;

/// The baud rates the termios path can set. `AdapterProfile::validate`
/// rejects anything else so a bad setting fails at `PUT /adapter`, not at
/// connect time.
pub const SUPPORTED_BAUDS: [u32; 6] = [9600, 19200, 38400, 57600, 115_200, 230_400];

pub struct ElmSerial {
    #[cfg(unix)]
    fd: std::os::unix::io::RawFd,
    path: String,
}

// The fd is only touched from the supervisor thread.
unsafe impl Send for ElmSerial {}

impl ElmSerial {
    /// Blocking open (a Bluetooth port forces the link up), run on a helper
    /// thread with a timeout so a wedged link can't hang the supervisor.
    #[cfg(unix)]
    pub fn open(path: &str, baud: u32) -> Result<Self, ElmError> {
        let speed = baud_constant(baud).ok_or_else(|| {
            ElmError::Open(format!(
                "unsupported baud rate {baud} (supported: {SUPPORTED_BAUDS:?})"
            ))
        })?;
        let path_owned = path.to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let c = std::ffi::CString::new(path_owned).unwrap();
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
    pub fn open(path: &str, _baud: u32) -> Result<Self, ElmError> {
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
