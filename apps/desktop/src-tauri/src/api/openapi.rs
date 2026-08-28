//! Hand-written route table + the OpenAPI 3 document generated from it.
//!
//! `ROUTES` is the single list every route is documented in; the router in
//! `api/mod.rs` is checked against it by a test (every documented route must
//! be served, and every required route must be documented), so the document
//! stays honest. Keep it in sync when adding a handler.

use serde_json::{json, Map, Value};

pub struct RouteDoc {
    pub method: &'static str,
    pub path: &'static str,
    pub summary: &'static str,
    /// Query parameters as (name, description). Path parameters are read
    /// from the `{braces}` in `path`.
    pub query: &'static [(&'static str, &'static str)],
    /// Example JSON request body, when the route takes one.
    pub body: Option<&'static str>,
    /// Needs a live connection to the car (otherwise 503).
    pub needs_car: bool,
    /// Changes the car; gated behind `{"confirmed": true}` (409 otherwise).
    pub write: bool,
}

const fn r(
    method: &'static str,
    path: &'static str,
    summary: &'static str,
    query: &'static [(&'static str, &'static str)],
    body: Option<&'static str>,
    needs_car: bool,
    write: bool,
) -> RouteDoc {
    RouteDoc {
        method,
        path,
        summary,
        query,
        body,
        needs_car,
        write,
    }
}

const VEHICLE_Q: &[(&str, &str)] = &[(
    "vehicle_id",
    "vehicle id; omitted = the current unidentified connection's rows",
)];

pub const ROUTES: &[RouteDoc] = &[
    // meta
    r("GET", "/", "Plain-text index of every route", &[], None, false, false),
    r("GET", "/health", "Liveness probe — the only route without auth", &[], None, false, false),
    r("GET", "/openapi.json", "This document", &[], None, false, false),
    r("GET", "/events", "Server-Sent Events relay of conn-status, live-update, uds-scan-progress, discovery-progress", &[], None, false, false),
    // connection
    r("POST", "/connect", "Start the connection supervisor (same loop as the UI's Connect: finds the adapter, cures Bluetooth sulk mode, keeps the link alive). Idempotent.", &[], None, false, false),
    r("POST", "/disconnect", "Stop the supervisor (cancels any running scan first)", &[], None, false, false),
    r("GET", "/status", "ConnStatus: state, ELM version, VIN/vehicle identity, scanning flag", &[], None, false, false),
    r("POST", "/vehicle/name", "Name the current VIN-less vehicle (creates the vehicles row and re-emits conn-status)", &[], Some(r#"{"name": "Grey C4 2006"}"#), true, false),
    // standard OBD
    r("GET", "/live", "Latest live PID readings (the last live-update broadcast) with their age", &[], None, false, false),
    r("GET", "/readings", "Stored readings for one key, oldest first", &[("vehicle_id", "vehicle id (omit for unidentified rows)"), ("key", "reading key, e.g. rpm, coolant, voltage"), ("since", "window in hours (default 24)"), ("limit", "keep only the newest N points")], None, false, false),
    r("GET", "/readings/keys", "Reading keys recorded for a vehicle", VEHICLE_Q, None, false, false),
    r("POST", "/dtc/scan", "Modes 03/07/0A/01: stored, pending, permanent codes, MIL, freeze frame", &[], None, true, false),
    r("POST", "/dtc/clear", "Mode 04 clear, verified with a before/after scan and logged to writes_log", &[], Some(r#"{"confirmed": true}"#), true, true),
    r("GET", "/dtc/history", "Past DTC scans, newest first", &[("vehicle_id", "vehicle id"), ("limit", "max rows (default 20)")], None, false, false),
    r("GET", "/ecu-info", "Mode 09: VIN, calibration ids, CVN, ECU name", &[], None, true, false),
    r("GET", "/readiness", "Mode 01 PID 01 readiness monitors", &[], None, true, false),
    r("GET", "/sensors", "Read every supported standard PID once", &[], None, true, false),
    r("GET", "/writes-log", "Audit trail of everything the app changed on the car", &[("vehicle_id", "vehicle id"), ("limit", "max rows (default 50)")], None, false, false),
    // UDS
    r("GET", "/uds/modules", "Built-in plus custom UDS modules (key, label, req/resp CAN ids)", &[], None, false, false),
    r("POST", "/uds/modules", "Add a custom module", &[], Some(r#"{"key": "bsi", "label": "Body computer", "req": "752", "resp": "652"}"#), false, false),
    r("DELETE", "/uds/modules/{key}", "Delete a custom module", &[], None, false, false),
    r("POST", "/uds/read", "Read one DID (0x22) from a module; null when the module does not answer", &[], Some(r#"{"module": "abs", "did": 53504}"#), true, false),
    r("POST", "/uds/read-many", "Read up to 64 DIDs from one module with the route configured once (fast enough for physical tests); unanswered DIDs are omitted", &[], Some(r#"{"module": "abs", "dids": [54272, 54273, 54303]}"#), true, false),
    r("POST", "/uds/scan", "Scan a DID range on one module (minutes; watch /events uds-scan-progress)", &[], Some(r#"{"module": "abs", "from": 53504, "to": 53759}"#), true, false),
    r("POST", "/uds/scan/cancel", "Abort the running range scan / discovery within one DID timeout", &[], None, false, false),
    r("POST", "/uds/discover", "One-button auto-discovery; full=true forces the blind sweep", &[], Some(r#"{"full": false}"#), true, false),
    r("GET", "/uds/modules/{key}/dtcs", "Fault codes stored on one module (UDS 19 02)", &[], None, true, false),
    r("POST", "/uds/clear", "Clear one module's fault memory (UDS 14), verified before/after", &[], Some(r#"{"module": "abs", "confirmed": true}"#), true, true),
    // evidence protocol
    r("POST", "/verification/parked", "Run the current parked verification plan (read-only 0x22; minutes). Saves a verification run.", &[], None, true, false),
    r("POST", "/verification/capture", "One guided-correlation capture under a labelled physical condition. Saves a verification run.", &[], Some(r#"{"req": "6A0", "resp": "68A", "dids": [54272, 54273], "step": "brake", "condition": "brake pedal pressed", "plan_version": "citroen-c41-v3", "repeats": 3}"#), true, false),
    r("GET", "/verification/runs", "Index of saved runs (no JSON bodies), newest first", &[("vehicle_id", "vehicle id"), ("plan_version", "exact plan version"), ("limit", "max rows (default 50)")], None, false, false),
    r("GET", "/verification/runs/{id}", "One run with its full result JSON", &[], None, false, false),
    // knowledge
    r("GET", "/vehicles", "Every vehicle known locally", &[], None, false, false),
    r("GET", "/vehicles/{id}", "One vehicle row", &[], None, false, false),
    r("GET", "/vehicles/{id}/modules", "Discovered modules with DID counts and ECU fingerprints", &[], None, false, false),
    r("GET", "/vehicles/{id}/evidence-map", "Evidence-only topology for one vehicle", &[], None, false, false),
    r("GET", "/vehicles/{id}/report", "Per-vehicle report (stats, scans, connections)", &[], None, false, false),
    r("POST", "/vehicles/{id}/name", "Rename a stored vehicle", &[], Some(r#"{"name": "Grey C4 2006"}"#), false, false),
    r("POST", "/vehicles/{id}/fuel-price", "Set the fuel price used for cost estimates", &[], Some(r#"{"price": 1.62}"#), false, false),
    r("GET", "/modules/{id}/dids", "Discovered DIDs of one module (by discovered_modules.id)", &[], None, false, false),
    // discovery knowledge layer (Universal Discovery Protocol S3 + coverage)
    r("GET", "/vehicles/{id}/coverage", "Coverage report from data: vehicle, standard, routes, identified modules, decode states, hypotheses, learning; every line carries evidence ids", &[], None, false, false),
    r("GET", "/vehicles/{id}/hypotheses", "Tracked hypotheses (DID x module) with knowledge_state / vehicle_fit / activation", &[], None, false, false),
    r("POST", "/vehicles/{id}/join", "S3 join: match fingerprinted modules to ecu_families, register inherited + unknown hypotheses. Local, idempotent, no car needed", &[], None, false, false),
    r("PATCH", "/hypotheses/{id}", "State transition; 409 with the violated rule when refused (enabled needs vehicle_fit=matched, learning needs learning-state on)", &[], Some(r#"{"vehicle_fit": "matched", "activation": "enabled", "label": "Wheel speed RL"}"#), false, false),
    r("GET", "/learning-state", "Whether learning activation is allowed ({\"on\": bool})", &[], None, false, false),
    r("PUT", "/learning-state", "Switch the learning state", &[], Some(r#"{"on": true}"#), false, false),
    r("GET", "/fingerprint-experiment", "Local VIN-free ECU fingerprint cohort measurement", &[], None, false, false),
    r("GET", "/probes", "Decode definitions polled live for a vehicle", VEHICLE_Q, None, false, false),
    r("POST", "/probes", "Add a probe (UdsProbe fields; vehicle_id scopes it)", &[], Some(r#"{"vehicle_id": 1, "module": "abs", "did": 54272, "label": "Wheel FL", "unit": "km/h", "offset": 0, "len": 2, "scale": 0.01, "bias": 0}"#), false, false),
    r("PATCH", "/probes/{id}", "Enable/disable ({\"enabled\": bool}) or replace the decode (full UdsProbe fields)", &[], Some(r#"{"enabled": false}"#), false, false),
    r("DELETE", "/probes/{id}", "Delete a probe", &[], None, false, false),
    r("GET", "/cases", "Diagnostic cases", VEHICLE_Q, None, false, false),
    r("POST", "/cases", "Open a diagnostic case", &[], Some(r#"{"vehicle_id": 1, "complaint": "ABS light on", "odometer_km": 180000, "assigned_to": null}"#), false, false),
    r("GET", "/settings/{key}", "Read an app_settings value", &[], None, false, false),
    r("PUT", "/settings/{key}", "Write an app_settings value (api_token is refused)", &[], Some(r#"{"value": "..."}"#), false, false),
    r("GET", "/sync/batch", "One cloud-sync batch of rows", &[("after_reading_id", "watermark"), ("limit", "max readings (1..20000)")], None, false, false),
    r("GET", "/db-path", "Path of the SQLite file", &[], None, false, false),
    // export
    r("GET", "/export/markdown", "Markdown briefing of the car, ready to paste into a chat", &[("vehicle_id", "vehicle id"), ("since_hours", "stats window (default 168)")], None, false, false),
    r("GET", "/export/json", "Everything in a window as one JSON blob", &[("vehicle_id", "vehicle id"), ("since_hours", "window (default 168)")], None, false, false),
];

/// Plain-text index served at `/`.
pub fn index_text(port: u16) -> String {
    let mut out = format!(
        "Scainner agent API on http://127.0.0.1:{port}\nAuthorization: Bearer <token> on every route except GET /health.\nWrite routes need a body {{\"confirmed\": true}}.\n\n"
    );
    for route in ROUTES {
        let flags = match (route.needs_car, route.write) {
            (_, true) => "  [car, WRITE, confirm-gated]",
            (true, false) => "  [car]",
            _ => "",
        };
        out.push_str(&format!(
            "{:<6} {:<32} {}{}\n",
            route.method, route.path, route.summary, flags
        ));
    }
    out
}

fn path_params(path: &str) -> Vec<&str> {
    path.split('/')
        .filter_map(|seg| seg.strip_prefix('{').and_then(|s| s.strip_suffix('}')))
        .collect()
}

/// Minimal but complete OpenAPI 3.0 document: every route, its parameters,
/// an example body where it takes one, and the shared error responses.
pub fn document(port: u16) -> Value {
    let mut paths: Map<String, Value> = Map::new();
    for route in ROUTES {
        let mut params: Vec<Value> = path_params(route.path)
            .into_iter()
            .map(|name| {
                json!({
                    "name": name, "in": "path", "required": true,
                    "schema": { "type": if name == "id" { "integer" } else { "string" } }
                })
            })
            .collect();
        for (name, description) in route.query {
            params.push(json!({
                "name": name, "in": "query", "required": false,
                "description": description, "schema": { "type": "string" }
            }));
        }
        let mut op = Map::new();
        op.insert("summary".into(), json!(route.summary));
        op.insert("x-needs-car".into(), json!(route.needs_car));
        op.insert("x-write".into(), json!(route.write));
        if !params.is_empty() {
            op.insert("parameters".into(), Value::Array(params));
        }
        if let Some(body) = route.body {
            let example: Value = serde_json::from_str(body).unwrap_or(Value::Null);
            op.insert(
                "requestBody".into(),
                json!({
                    "required": route.write,
                    "content": { "application/json": { "schema": { "type": "object" }, "example": example } }
                }),
            );
        }
        let mut responses = Map::new();
        responses.insert(
            "200".into(),
            json!({ "description": "OK (JSON unless noted; / and /export/markdown are text)" }),
        );
        if route.path != "/health" {
            responses.insert(
                "401".into(),
                json!({ "$ref": "#/components/responses/Unauthorized" }),
            );
        }
        if route.write {
            responses.insert(
                "409".into(),
                json!({ "$ref": "#/components/responses/NotConfirmed" }),
            );
        }
        if route.needs_car {
            responses.insert(
                "503".into(),
                json!({ "$ref": "#/components/responses/NotConnected" }),
            );
        }
        op.insert("responses".into(), Value::Object(responses));
        if route.path != "/health" {
            op.insert("security".into(), json!([{ "bearerAuth": [] }]));
        }
        let entry = paths
            .entry(route.path.to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        entry
            .as_object_mut()
            .expect("path item is an object")
            .insert(route.method.to_lowercase(), Value::Object(op));
    }

    json!({
        "openapi": "3.0.3",
        "info": {
            "title": "Scainner agent API",
            "version": env!("CARGO_PKG_VERSION"),
            "description": "Local HTTP/JSON front door to the running Scainner desktop app. Shares the app's single serial connection, supervisor and SQLite database. Read-only by default; the two write routes are confirm-gated. Never sends UDS 2E/2F/31/11/27."
        },
        "servers": [{ "url": format!("http://127.0.0.1:{port}") }],
        "components": {
            "securitySchemes": {
                "bearerAuth": { "type": "http", "scheme": "bearer", "description": "Token from app_settings.api_token, also written to <app data dir>/api-token" }
            },
            "responses": {
                "Unauthorized": { "description": "Missing or wrong bearer token" },
                "NotConfirmed": { "description": "Write refused: body lacks {\"confirmed\": true}. The response carries the current state under `before`." },
                "NotConnected": { "description": "No live connection to the car (POST /connect first, then poll /status)" }
            }
        },
        "paths": Value::Object(paths)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_route_is_in_the_document_once() {
        let doc = document(47811);
        let paths = doc["paths"].as_object().unwrap();
        for route in ROUTES {
            let item = paths
                .get(route.path)
                .unwrap_or_else(|| panic!("{} missing from openapi paths", route.path));
            assert!(
                item.get(route.method.to_lowercase()).is_some(),
                "{} {} missing from openapi",
                route.method,
                route.path
            );
        }
        let ops: usize = paths.values().map(|p| p.as_object().unwrap().len()).sum();
        assert_eq!(ops, ROUTES.len(), "document has extra operations");
    }

    #[test]
    fn capture_example_uses_the_current_plan_version() {
        // `ROUTES` is a const slice, so the example is a literal; keep it in
        // step with the producer's constant rather than a copy of it.
        let capture = ROUTES
            .iter()
            .find(|r| r.path == "/verification/capture")
            .unwrap();
        let example: Value = serde_json::from_str(capture.body.unwrap()).unwrap();
        assert_eq!(
            example["plan_version"],
            crate::elm::uds::PARKED_PLAN_VERSION,
            "OpenAPI example plan_version drifted from the producer"
        );
    }
}
