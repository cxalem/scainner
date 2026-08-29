//! Replay transport: a recorded command/response script for tests. Every
//! command must arrive in the recorded order; a step may instead raise one
//! of the driver's error categories or demand a minimum timeout so the
//! fixture also pins the caller's timing.

use super::{Transport, TransportInfo};
use crate::elm::driver::ElmError;
use serde::Deserialize;
use std::collections::VecDeque;
use std::time::Duration;

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

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ReplayError {
    NoResponse,
    Io,
    Handshake,
}

pub struct Replay {
    name: String,
    steps: VecDeque<ReplayStep>,
    observed: Vec<String>,
}

impl Replay {
    pub fn from_json(raw: &str) -> Result<Self, String> {
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
            name: fixture.name,
            steps: fixture.steps.into(),
            observed: Vec::new(),
        })
    }

    pub fn assert_complete(&self) {
        assert!(
            self.steps.is_empty(),
            "replay {:?} ended with {} unconsumed steps after commands {:?}",
            self.name,
            self.steps.len(),
            self.observed
        );
    }
}

impl Transport for Replay {
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
            (None, Some(ReplayError::Io)) => Err(ElmError::Io(format!(
                "replay {:?} injected io failure at {command:?}",
                self.name
            ))),
            (None, Some(ReplayError::Handshake)) => Err(ElmError::Handshake(format!(
                "replay {:?} injected handshake failure at {command:?}",
                self.name
            ))),
            _ => Err(ElmError::Handshake(format!(
                "replay {:?} step {command:?} must define exactly one of response or error",
                self.name
            ))),
        }
    }

    fn close(&mut self) {}

    fn describe(&self) -> TransportInfo {
        TransportInfo {
            kind: "replay".into(),
            target: self.name.clone(),
            banner: None,
        }
    }

    fn assert_replay_complete(&self) {
        self.assert_complete();
    }
}
