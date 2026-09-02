pub mod bluetooth;
pub mod elm_serial;
pub mod enumerate;
pub mod profile;
#[cfg(test)]
pub mod replay;
pub mod tcp_elm;

use super::driver::ElmError;
use serde::Serialize;
use std::time::Duration;

pub use profile::{AdapterKind, AdapterProfile, TimingProfile};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct TransportInfo {
    pub kind: String,
    pub target: String,
    pub banner: Option<String>,
}

pub trait Transport: Send {
    fn cmd(&mut self, cmd: &str, timeout: Duration) -> Result<String, ElmError>;
    fn close(&mut self);
    fn describe(&self) -> TransportInfo;
    #[cfg(test)]
    fn assert_replay_complete(&self) {
        panic!(
            "assert_replay_complete called on a {} transport",
            self.describe().kind
        );
    }
}

pub fn open(profile: &AdapterProfile) -> Result<Box<dyn Transport>, ElmError> {
    match profile.kind {
        AdapterKind::ElmSerial => {
            let path = profile.path.clone().ok_or_else(|| {
                ElmError::Open(
                    "no serial port configured: set adapter.path (or SCAINNER_OBD_PORT)".into(),
                )
            })?;
            Ok(Box::new(elm_serial::ElmSerial::open(
                &path,
                profile.baud,
                profile.bt_addr.as_deref(),
            )?))
        }
        AdapterKind::TcpElm => {
            let host = profile.host.clone().ok_or_else(|| {
                ElmError::Open("no adapter host configured: set adapter.host".into())
            })?;
            Ok(Box::new(tcp_elm::TcpElm::open(
                &host,
                profile.port,
                profile.timing.scale(Duration::from_secs(5)),
            )?))
        }
    }
}

pub(crate) fn read_until_prompt(
    timeout: Duration,
    mut read: impl FnMut(&mut [u8]) -> Result<usize, String>,
) -> Result<String, ElmError> {
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 256];
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        let n = read(&mut chunk).map_err(ElmError::Io)?;
        if n > 0 {
            buf.extend_from_slice(&chunk[..n]);
            if buf.contains(&b'>') {
                break;
            }
        } else {
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    if buf.is_empty() {
        return Err(ElmError::NoResponse);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_until_prompt_stops_at_the_prompt_and_reports_silence() {
        let mut chunks = vec![b"41 00".to_vec(), b" BE\r>".to_vec()].into_iter();
        let out = read_until_prompt(Duration::from_secs(1), |buf| {
            let Some(c) = chunks.next() else { return Ok(0) };
            buf[..c.len()].copy_from_slice(&c);
            Ok(c.len())
        })
        .unwrap();
        assert_eq!(out, "41 00 BE\r>");

        let silent = read_until_prompt(Duration::from_millis(30), |_| Ok(0));
        assert!(matches!(silent, Err(ElmError::NoResponse)));

        let broken = read_until_prompt(Duration::from_secs(1), |_| Err("EIO".into()));
        assert!(matches!(broken, Err(ElmError::Io(_))));
    }
}
