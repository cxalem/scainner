use serde::Serialize;

use super::driver::ElmError;

/// Machine-readable result of one diagnostic interaction. Human copy belongs
/// in the UI; `detail` preserves transport/ECU evidence for logs and reports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
// The complete wire vocabulary is defined up front so later scanner paths do
// not invent incompatible states while this contract is adopted incrementally.
#[allow(dead_code)]
pub enum DiagnosticStatus {
    Answered,
    Unsupported,
    Refused,
    TimedOut,
    TransportFailed,
    Cancelled,
    SkippedForSafety,
    Malformed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiagnosticOutcome {
    pub status: DiagnosticStatus,
    pub service: Option<String>,
    pub nrc: Option<u8>,
    pub detail: Option<String>,
}

impl DiagnosticOutcome {
    pub fn answered(service: impl Into<String>) -> Self {
        Self::new(DiagnosticStatus::Answered, Some(service.into()), None, None)
    }

    pub fn refused(service: impl Into<String>, nrc: u8, detail: impl Into<String>) -> Self {
        Self::new(
            DiagnosticStatus::Refused,
            Some(service.into()),
            Some(nrc),
            Some(detail.into()),
        )
    }

    pub fn timed_out(service: impl Into<String>) -> Self {
        Self::new(DiagnosticStatus::TimedOut, Some(service.into()), None, None)
    }

    pub fn transport_failed(service: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::new(
            DiagnosticStatus::TransportFailed,
            Some(service.into()),
            None,
            Some(detail.into()),
        )
    }

    pub fn malformed(service: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::new(
            DiagnosticStatus::Malformed,
            Some(service.into()),
            None,
            Some(detail.into()),
        )
    }

    pub fn from_elm_error(service: impl Into<String>, error: &ElmError) -> Self {
        let service = service.into();
        match error {
            ElmError::NoResponse => Self::timed_out(service),
            ElmError::Open(_) | ElmError::Io(_) => {
                Self::transport_failed(service, error.to_string())
            }
            ElmError::Handshake(_) => Self::malformed(service, error.to_string()),
        }
    }

    pub fn cancelled() -> Self {
        Self::new(
            DiagnosticStatus::Cancelled,
            Some("discovery".into()),
            None,
            None,
        )
    }

    pub fn skipped_for_safety(detail: impl Into<String>) -> Self {
        Self::new(
            DiagnosticStatus::SkippedForSafety,
            Some("discovery".into()),
            None,
            Some(detail.into()),
        )
    }

    fn new(
        status: DiagnosticStatus,
        service: Option<String>,
        nrc: Option<u8>,
        detail: Option<String>,
    ) -> Self {
        Self {
            status,
            service,
            nrc,
            detail,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_every_status_in_the_shared_vocabulary() {
        let statuses = [
            DiagnosticStatus::Answered,
            DiagnosticStatus::Unsupported,
            DiagnosticStatus::Refused,
            DiagnosticStatus::TimedOut,
            DiagnosticStatus::TransportFailed,
            DiagnosticStatus::Cancelled,
            DiagnosticStatus::SkippedForSafety,
            DiagnosticStatus::Malformed,
        ];
        let serialized: Vec<String> = statuses
            .into_iter()
            .map(|status| {
                serde_json::to_value(status)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .into()
            })
            .collect();

        assert_eq!(
            serialized,
            [
                "answered",
                "unsupported",
                "refused",
                "timed_out",
                "transport_failed",
                "cancelled",
                "skipped_for_safety",
                "malformed",
            ]
        );
    }

    #[test]
    fn serializes_as_the_shared_snake_case_contract() {
        assert_eq!(
            serde_json::to_value(DiagnosticOutcome::refused(
                "14",
                0x22,
                "conditionsNotCorrect"
            ))
            .unwrap(),
            serde_json::json!({
                "status": "refused",
                "service": "14",
                "nrc": 34,
                "detail": "conditionsNotCorrect"
            })
        );
    }
}
