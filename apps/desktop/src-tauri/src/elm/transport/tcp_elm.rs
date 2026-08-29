//! ELM327 Wi-Fi adapters: the same AT protocol over a TCP socket
//! (typically `192.168.0.10:35000`).

use super::{read_until_prompt, Transport, TransportInfo};
use crate::elm::driver::ElmError;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

pub struct TcpElm {
    stream: Option<TcpStream>,
    target: String,
}

impl TcpElm {
    pub fn open(host: &str, port: u16, connect_timeout: Duration) -> Result<Self, ElmError> {
        let target = format!("{host}:{port}");
        let addr = target
            .to_socket_addrs()
            .map_err(|e| ElmError::Open(format!("{target}: {e}")))?
            .next()
            .ok_or_else(|| ElmError::Open(format!("{target}: no address")))?;
        let stream = TcpStream::connect_timeout(&addr, connect_timeout)
            .map_err(|e| ElmError::Open(format!("{target}: {e}")))?;
        // Same 100 ms granularity as the serial VTIME so the shared read
        // loop behaves identically.
        stream
            .set_read_timeout(Some(Duration::from_millis(100)))
            .map_err(|e| ElmError::Open(e.to_string()))?;
        stream
            .set_nodelay(true)
            .map_err(|e| ElmError::Open(e.to_string()))?;
        Ok(Self {
            stream: Some(stream),
            target,
        })
    }
}

fn is_timeout(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    )
}

impl Transport for TcpElm {
    fn cmd(&mut self, c: &str, timeout: Duration) -> Result<String, ElmError> {
        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| ElmError::Io("socket closed".into()))?;
        // Drain stale bytes from a previous command that answered late
        // (the serial transport's tcflush equivalent).
        let mut junk = [0u8; 256];
        loop {
            match stream.read(&mut junk) {
                Ok(n) if n > 0 => continue,
                _ => break,
            }
        }
        stream
            .write_all(format!("{c}\r").as_bytes())
            .map_err(|e| ElmError::Io(e.to_string()))?;
        stream.flush().map_err(|e| ElmError::Io(e.to_string()))?;
        read_until_prompt(timeout, |chunk| match stream.read(chunk) {
            Ok(n) => Ok(n),
            Err(e) if is_timeout(&e) => Ok(0),
            Err(e) => Err(e.to_string()),
        })
    }

    fn close(&mut self) {
        if let Some(stream) = self.stream.take() {
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
    }

    fn describe(&self) -> TransportInfo {
        TransportInfo {
            kind: "tcp_elm".into(),
            target: self.target.clone(),
            banner: None,
        }
    }
}
