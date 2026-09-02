//! The embedded agent API: an HTTP/JSON server on 127.0.0.1 living INSIDE the
//! Tauri process, so an agent (or curl) shares the app's one serial
//! connection, supervisor and SQLite handle. Every handler is an adapter over
//! `ops` — the same functions the Tauri commands call — so the UI and the
//! API can never disagree about what a request does to the car.
//!
//! Auth: `Authorization: Bearer <token>` on every route but `GET /health`.
//! The token is generated once and stored in `app_settings.api_token`, and
//! mirrored to `<app data dir>/api-token` (0600) for local agents to read.
//! Safety: read-only by default; `POST /dtc/clear` and `POST /uds/clear`
//! refuse (409, with the before-state) unless the body says
//! `{"confirmed": true}`. Nothing here can send UDS 2E/2F/31/11/27 — the
//! supervisor has no such request.
//!
//! Full route list + curl examples: `apps/desktop/docs/api.md`.

pub mod openapi;
pub mod ops;

use crate::elm::transport::bluetooth;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use ops::AppState;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tokio_stream::{Stream, StreamExt};

pub const DEFAULT_PORT: u16 = 47811;
pub const TOKEN_SETTING: &str = "api_token";
pub const PORT_SETTING: &str = "api_port";
/// Tauri events the supervisor already broadcasts to the UI, relayed as-is
/// over `GET /events` (SSE `event:` name = Tauri event name).
const RELAYED_EVENTS: &[&str] = &[
    "conn-status",
    "live-update",
    "uds-scan-progress",
    "discovery-progress",
    "unknown-brand",
];

#[derive(Clone, Debug)]
pub struct ApiEvent {
    pub name: String,
    pub json: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct LiveSnapshot {
    pub ts_unix_ms: u128,
    pub values: Value,
}

pub struct ApiState {
    pub state: Arc<AppState>,
    /// `None` only under test — `POST /connect` needs it to spawn the
    /// supervisor (which emits Tauri events).
    pub app: Option<tauri::AppHandle>,
    pub token: String,
    pub port: u16,
    pub events: broadcast::Sender<ApiEvent>,
    pub live: Mutex<Option<LiveSnapshot>>,
}

impl ApiState {
    fn new(state: Arc<AppState>, app: Option<tauri::AppHandle>, token: String, port: u16) -> Self {
        let (events, _) = broadcast::channel(256);
        Self {
            state,
            app,
            token,
            port,
            events,
            live: Mutex::new(None),
        }
    }

    #[cfg(test)]
    pub fn for_tests(state: Arc<AppState>, token: &str) -> Arc<Self> {
        Arc::new(Self::new(state, None, token.to_string(), DEFAULT_PORT))
    }

    fn record(&self, name: &str, json: &str) {
        if name == "live-update" {
            if let Ok(values) = serde_json::from_str::<Value>(json) {
                *ops::lock_or_recover(&self.live) = Some(LiveSnapshot {
                    ts_unix_ms: now_ms(),
                    values,
                });
            }
        }
        let _ = self.events.send(ApiEvent {
            name: name.to_string(),
            json: json.to_string(),
        });
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Returns the stored token, minting one on first run.
pub fn ensure_token(db: &crate::db::Db) -> String {
    if let Some(existing) = db.setting_get(TOKEN_SETTING).filter(|t| !t.is_empty()) {
        return existing;
    }
    // Two v4 uuids = 256 random bits from the OS RNG; no extra dependency.
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    db.setting_set(TOKEN_SETTING, &token);
    token
}

fn write_private_file(path: &std::path::Path, contents: &str) {
    if let Err(error) = std::fs::write(path, contents) {
        log::warn!("could not write {}: {error}", path.display());
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
}

/// Starts the server from Tauri `setup`: mints/loads the token, installs the
/// event relay, binds 127.0.0.1:<api_port|47811> (falling back to an
/// ephemeral port if taken) and writes `api-token` / `api-port` next to the
/// database so a local agent can find both.
pub fn start(app: tauri::AppHandle, state: Arc<AppState>) {
    use tauri::{Listener, Manager};

    let token = ensure_token(&state.db);
    let port = state
        .db
        .setting_get(PORT_SETTING)
        .and_then(|p| p.trim().parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    write_private_file(&data_dir.join("api-token"), &token);

    let api = Arc::new(ApiState::new(state, Some(app.clone()), token, port));
    for name in RELAYED_EVENTS {
        let api = api.clone();
        app.listen(*name, move |event| api.record(name, event.payload()));
    }

    let router = router(api.clone());
    tauri::async_runtime::spawn(async move {
        let want = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = match tokio::net::TcpListener::bind(want).await {
            Ok(l) => l,
            Err(error) => {
                log::warn!("agent API: port {port} unavailable ({error}); using an ephemeral port");
                match tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await {
                    Ok(l) => l,
                    Err(error) => {
                        log::error!("agent API: could not bind any loopback port: {error}");
                        return;
                    }
                }
            }
        };
        let actual = listener.local_addr().map(|a| a.port()).unwrap_or(port);
        write_private_file(&data_dir.join("api-port"), &actual.to_string());
        log::info!(
            "agent API listening on http://127.0.0.1:{actual} (token in {})",
            data_dir.join("api-token").display()
        );
        if let Err(error) = axum::serve(listener, router).await {
            log::error!("agent API server stopped: {error}");
        }
    });
}

// ---------- errors ----------

pub struct ApiError(StatusCode, Value);

impl ApiError {
    fn new(status: StatusCode, body: Value) -> Self {
        Self(status, body)
    }
    fn msg(status: StatusCode, message: impl Into<String>) -> Self {
        Self(status, json!({ "error": message.into() }))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}

/// Maps the ops layer's string errors onto HTTP: no supervisor / dongle →
/// 503, the confirm rail → 409, everything else → 500.
fn op_err(error: String) -> ApiError {
    let status = if error.contains("not connected") || error.contains("supervisor gone") {
        StatusCode::SERVICE_UNAVAILABLE
    } else if error.starts_with("Write not confirmed") {
        StatusCode::CONFLICT
    } else if error.contains("timed out") {
        StatusCode::GATEWAY_TIMEOUT
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };
    ApiError::msg(status, error)
}

type ApiResult = Result<Response, ApiError>;

fn ok<T: Serialize>(value: T) -> ApiResult {
    Ok(Json(value).into_response())
}

/// Lenient body parsing: an empty body is `T::default()`, anything else must
/// be JSON of the right shape (400 otherwise). Lets curl call the write
/// routes with no body and still get the honest 409.
fn parse_body<T: DeserializeOwned + Default>(body: &Bytes) -> Result<T, ApiError> {
    if body.iter().all(|b| b.is_ascii_whitespace()) {
        return Ok(T::default());
    }
    serde_json::from_slice(body)
        .map_err(|e| ApiError::msg(StatusCode::BAD_REQUEST, format!("invalid JSON body: {e}")))
}

fn parse_required<T: DeserializeOwned>(body: &Bytes) -> Result<T, ApiError> {
    serde_json::from_slice(body)
        .map_err(|e| ApiError::msg(StatusCode::BAD_REQUEST, format!("invalid JSON body: {e}")))
}

// ---------- auth ----------

async fn auth(
    State(api): State<Arc<ApiState>>,
    headers: HeaderMap,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim);
    if presented == Some(api.token.as_str()) {
        next.run(req).await
    } else {
        ApiError::msg(
            StatusCode::UNAUTHORIZED,
            "missing or wrong bearer token — read it from app_settings.api_token or <app data dir>/api-token",
        )
        .into_response()
    }
}

// ---------- router ----------

pub fn router(api: Arc<ApiState>) -> Router {
    let authed = Router::new()
        .route("/", get(index))
        .route("/openapi.json", get(openapi_doc))
        .route("/events", get(events))
        // connection
        .route("/connect", post(connect))
        .route("/disconnect", post(disconnect))
        .route("/status", get(status))
        .route("/vehicle/name", post(name_current_vehicle))
        // standard OBD
        .route("/live", get(live))
        .route("/readings", get(readings))
        .route("/readings/keys", get(reading_keys))
        .route("/readings/keys/details", get(reading_key_details))
        .route("/dtc/scan", post(dtc_scan))
        .route("/dtc/clear", post(dtc_clear))
        .route("/dtc/history", get(dtc_history))
        .route("/ecu-info", get(ecu_info))
        .route("/readiness", get(readiness))
        .route("/sensors", get(sensors))
        .route("/writes-log", get(writes_log))
        // UDS
        .route("/uds/modules", get(uds_modules).post(add_uds_module))
        .route(
            "/uds/modules/{key}",
            axum::routing::delete(delete_uds_module),
        )
        .route("/uds/modules/{key}/dtcs", get(uds_module_dtcs))
        .route("/uds/read", post(uds_read))
        .route("/uds/read-many", post(uds_read_many))
        .route("/uds/scan", post(uds_scan))
        .route("/uds/scan/cancel", post(uds_scan_cancel))
        .route("/uds/discover", post(uds_discover))
        .route("/uds/clear", post(uds_clear))
        // evidence protocol
        .route("/verification/parked", post(verification_parked))
        .route("/verification/capture", post(verification_capture))
        .route("/verification/runs", get(verification_runs))
        .route("/verification/runs/{id}", get(verification_run))
        // knowledge
        .route("/vehicles", get(vehicles))
        .route(
            "/vehicles/{id}",
            get(vehicle).delete(delete_vehicle_private_data),
        )
        .route("/vehicles/{id}/modules", get(vehicle_modules))
        .route("/vehicles/{id}/evidence-map", get(vehicle_evidence_map))
        .route("/vehicles/{id}/report", get(vehicle_report))
        .route("/vehicles/{id}/name", post(set_vehicle_name))
        .route("/vehicles/{id}/fuel-price", post(set_fuel_price))
        .route("/modules/{id}/dids", get(module_dids))
        // discovery knowledge layer
        .route("/vehicles/{id}/coverage", get(vehicle_coverage))
        .route("/vehicles/{id}/parked-plan", get(vehicle_parked_plan))
        .route("/vehicles/{id}/guided-steps", get(vehicle_guided_steps))
        .route("/vehicles/{id}/hypotheses", get(vehicle_hypotheses))
        .route("/vehicles/{id}/join", post(vehicle_join))
        .route("/knowledge/candidates", get(knowledge_candidates))
        .route("/hypotheses/{id}", axum::routing::patch(patch_hypothesis))
        .route(
            "/learning-state",
            get(learning_state).put(set_learning_state),
        )
        .route("/fingerprint-experiment", get(fingerprint_experiment))
        .route("/probes", get(probes).post(add_probe))
        .route(
            "/probes/{id}",
            axum::routing::patch(patch_probe).delete(delete_probe),
        )
        .route("/cases", get(cases).post(create_case))
        .route("/settings/{key}", get(setting_get).put(setting_set))
        .route("/adapters", get(adapters))
        .route("/adapters/discover", post(adapters_discover))
        .route("/adapters/pair", post(adapters_pair))
        .route("/adapter", get(adapter_get).put(adapter_set))
        .route("/sync/batch", get(sync_batch))
        .route("/db-path", get(db_path))
        // export
        .route("/export/markdown", get(export_markdown))
        .route("/export/json", get(export_json))
        .layer(middleware::from_fn_with_state(api.clone(), auth));

    Router::new()
        .route("/health", get(health))
        .merge(authed)
        .with_state(api)
}

// ---------- meta ----------

async fn health(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(json!({
        "ok": true,
        "app": env!("CARGO_PKG_NAME"),
        "version": env!("CARGO_PKG_VERSION"),
        "connection": ops::conn_status(&api.state).state,
    }))
}

async fn index(State(api): State<Arc<ApiState>>) -> Response {
    openapi::index_text(api.port).into_response()
}

async fn openapi_doc(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(openapi::document(api.port))
}

async fn events(
    State(api): State<Arc<ApiState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = api.events.subscribe();
    let stream = tokio_stream::wrappers::BroadcastStream::new(rx)
        .filter_map(|item| item.ok())
        .map(|ev| Ok(Event::default().event(ev.name).data(ev.json)));
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ---------- connection ----------

async fn connect(State(api): State<Arc<ApiState>>) -> ApiResult {
    let app = api.app.clone().ok_or_else(|| {
        ApiError::msg(
            StatusCode::SERVICE_UNAVAILABLE,
            "no app handle (test mode) — cannot spawn the supervisor",
        )
    })?;
    ops::connect(&api.state, app).map_err(op_err)?;
    ok(ops::conn_status(&api.state))
}

async fn disconnect(State(api): State<Arc<ApiState>>) -> ApiResult {
    ops::disconnect(&api.state).map_err(op_err)?;
    ok(ops::conn_status(&api.state))
}

async fn status(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(ops::conn_status(&api.state))
}

#[derive(Deserialize, Default)]
struct NameBody {
    name: String,
}

async fn name_current_vehicle(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let b: NameBody = parse_required(&body)?;
    let id = ops::name_current_vehicle(&api.state, b.name)
        .await
        .map_err(op_err)?;
    ok(json!({ "vehicle_id": id }))
}

// ---------- standard OBD ----------

async fn live(State(api): State<Arc<ApiState>>) -> ApiResult {
    let snapshot = ops::lock_or_recover(&api.live).clone();
    match snapshot {
        Some(s) => ok(json!({
            "ts_unix_ms": s.ts_unix_ms,
            "age_ms": now_ms().saturating_sub(s.ts_unix_ms),
            "values": s.values,
            "connection": ops::conn_status(&api.state).state,
        })),
        None => ok(json!({
            "ts_unix_ms": null,
            "age_ms": null,
            "values": {},
            "connection": ops::conn_status(&api.state).state,
            "note": "no live-update received yet on this process — connect and wait for polling",
        })),
    }
}

#[derive(Deserialize)]
struct ReadingsQuery {
    vehicle_id: Option<i64>,
    key: String,
    since: Option<f64>,
    limit: Option<usize>,
}

async fn readings(State(api): State<Arc<ApiState>>, Query(q): Query<ReadingsQuery>) -> ApiResult {
    let mut points = ops::history(&api.state, q.vehicle_id, &q.key, q.since.unwrap_or(24.0));
    if let Some(limit) = q.limit {
        let drop = points.len().saturating_sub(limit);
        points.drain(..drop);
    }
    ok(points)
}

#[derive(Deserialize)]
struct VehicleQuery {
    vehicle_id: Option<i64>,
    limit: Option<i64>,
}

async fn reading_keys(
    State(api): State<Arc<ApiState>>,
    Query(q): Query<VehicleQuery>,
) -> ApiResult {
    ok(ops::reading_keys(&api.state, q.vehicle_id))
}

/// The enriched form of the above: `/readings/keys` stays a plain string
/// array so existing clients (the MCP `reading_keys` tool) keep working.
async fn reading_key_details(
    State(api): State<Arc<ApiState>>,
    Query(q): Query<VehicleQuery>,
) -> ApiResult {
    ok(ops::reading_key_details(&api.state, q.vehicle_id))
}

async fn dtc_scan(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(ops::scan_dtcs(&api.state).await.map_err(op_err)?)
}

#[derive(Deserialize, Default)]
struct ConfirmBody {
    #[serde(default)]
    confirmed: bool,
}

fn not_confirmed(before: Value) -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        json!({
            "error": "Write not confirmed. This changes the car: re-send with {\"confirmed\": true} after reviewing `before`.",
            "confirm_with": { "confirmed": true },
            "before": before,
        }),
    )
}

async fn dtc_clear(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let b: ConfirmBody = parse_body(&body)?;
    if !b.confirmed {
        let before = match ops::scan_dtcs(&api.state).await {
            Ok(scan) => serde_json::to_value(scan).unwrap_or(Value::Null),
            Err(error) => json!({ "unavailable": error }),
        };
        return Err(not_confirmed(before));
    }
    ok(ops::clear_dtcs(&api.state, true).await.map_err(op_err)?)
}

async fn dtc_history(State(api): State<Arc<ApiState>>, Query(q): Query<VehicleQuery>) -> ApiResult {
    ok(ops::dtc_history(
        &api.state,
        q.vehicle_id,
        q.limit.unwrap_or(20),
    ))
}

async fn ecu_info(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(ops::read_ecu_info(&api.state).await.map_err(op_err)?)
}

async fn readiness(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(ops::readiness(&api.state).await.map_err(op_err)?)
}

async fn sensors(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(ops::all_sensors(&api.state).await.map_err(op_err)?)
}

async fn writes_log(State(api): State<Arc<ApiState>>, Query(q): Query<VehicleQuery>) -> ApiResult {
    ok(ops::writes_log(
        &api.state,
        q.vehicle_id,
        q.limit.unwrap_or(50),
    ))
}

// ---------- UDS ----------

async fn uds_modules(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(ops::uds_modules(&api.state))
}

#[derive(Deserialize)]
struct ModuleBody {
    key: String,
    label: String,
    req: String,
    resp: String,
}

async fn add_uds_module(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let m: ModuleBody = parse_required(&body)?;
    ops::add_uds_module(&api.state, &m.key, &m.label, &m.req, &m.resp)
        .map_err(|e| ApiError::msg(StatusCode::BAD_REQUEST, e))?;
    ok(ops::uds_modules(&api.state))
}

async fn delete_uds_module(State(api): State<Arc<ApiState>>, Path(key): Path<String>) -> ApiResult {
    ops::delete_uds_module(&api.state, &key);
    ok(json!({ "deleted": key }))
}

async fn uds_module_dtcs(State(api): State<Arc<ApiState>>, Path(key): Path<String>) -> ApiResult {
    ok(ops::uds_module_dtcs(&api.state, key)
        .await
        .map_err(op_err)?)
}

#[derive(Deserialize)]
struct UdsReadBody {
    module: String,
    did: u16,
}

#[derive(Deserialize)]
struct UdsReadManyBody {
    module: String,
    dids: Vec<u16>,
}

async fn uds_read_many(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let b: UdsReadManyBody = parse_required(&body)?;
    if b.dids.is_empty() || b.dids.len() > 64 {
        return Err(ApiError::msg(
            StatusCode::BAD_REQUEST,
            "dids must contain between 1 and 64 identifiers",
        ));
    }
    ok(ops::uds_read_many(&api.state, b.module, b.dids)
        .await
        .map_err(op_err)?)
}

async fn uds_read(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let b: UdsReadBody = parse_required(&body)?;
    ok(ops::uds_read(&api.state, b.module, b.did)
        .await
        .map_err(op_err)?)
}

#[derive(Deserialize)]
struct UdsScanBody {
    module: String,
    from: u16,
    to: u16,
}

async fn uds_scan(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let b: UdsScanBody = parse_required(&body)?;
    if b.from > b.to {
        return Err(ApiError::msg(StatusCode::BAD_REQUEST, "from must be <= to"));
    }
    ok(ops::uds_scan(&api.state, b.module, b.from, b.to)
        .await
        .map_err(op_err)?)
}

async fn uds_scan_cancel(State(api): State<Arc<ApiState>>) -> ApiResult {
    ops::uds_cancel_scan(&api.state);
    ok(json!({ "cancel_requested": true }))
}

#[derive(Deserialize, Default)]
struct DiscoverBody {
    #[serde(default)]
    full: bool,
}

async fn uds_discover(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let b: DiscoverBody = parse_body(&body)?;
    ok(ops::discover_sensors(&api.state, b.full)
        .await
        .map_err(op_err)?)
}

#[derive(Deserialize, Default)]
struct UdsClearBody {
    #[serde(default)]
    module: String,
    #[serde(default)]
    confirmed: bool,
}

async fn uds_clear(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let b: UdsClearBody = parse_body(&body)?;
    if b.module.is_empty() {
        return Err(ApiError::msg(StatusCode::BAD_REQUEST, "module is required"));
    }
    if !b.confirmed {
        let before = match ops::uds_module_dtcs(&api.state, b.module.clone()).await {
            Ok(dtcs) => json!({ "module": b.module, "dtcs": dtcs }),
            Err(error) => json!({ "module": b.module, "unavailable": error }),
        };
        return Err(not_confirmed(before));
    }
    ok(ops::uds_clear(&api.state, b.module, true)
        .await
        .map_err(op_err)?)
}

// ---------- evidence protocol ----------

async fn verification_parked(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(ops::parked_verification(&api.state).await.map_err(op_err)?)
}

async fn verification_capture(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let args: ops::CorrelationCaptureArgs = parse_required(&body)?;
    if args.dids.is_empty() {
        return Err(ApiError::msg(
            StatusCode::BAD_REQUEST,
            "dids must not be empty",
        ));
    }
    ok(ops::correlation_capture(&api.state, args)
        .await
        .map_err(op_err)?)
}

#[derive(Deserialize)]
struct RunsQuery {
    vehicle_id: Option<i64>,
    plan_version: Option<String>,
    limit: Option<i64>,
}

async fn verification_runs(
    State(api): State<Arc<ApiState>>,
    Query(q): Query<RunsQuery>,
) -> ApiResult {
    ok(ops::list_verification_runs(
        &api.state,
        q.vehicle_id,
        q.plan_version.as_deref(),
        q.limit.unwrap_or(50),
    ))
}

async fn verification_run(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    let (row, json) = ops::verification_run(&api.state, id).ok_or_else(|| {
        ApiError::msg(StatusCode::NOT_FOUND, format!("no verification run #{id}"))
    })?;
    let result: Value = serde_json::from_str(&json).unwrap_or(Value::String(json));
    ok(json!({
        "id": row.id,
        "vehicle_id": row.vehicle_id,
        "connection_id": row.connection_id,
        "plan_version": row.plan_version,
        "created_at": row.created_at,
        "result": result,
    }))
}

// ---------- knowledge ----------

async fn vehicles(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(ops::list_vehicles(&api.state))
}

async fn knowledge_candidates(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(ops::knowledge_candidates(&api.state))
}

async fn vehicle(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    match ops::vehicle_info(&api.state, id) {
        Some(v) => ok(v),
        None => Err(ApiError::msg(
            StatusCode::NOT_FOUND,
            format!("no vehicle #{id}"),
        )),
    }
}

async fn delete_vehicle_private_data(
    State(api): State<Arc<ApiState>>,
    Path(id): Path<i64>,
    body: Bytes,
) -> ApiResult {
    let confirmation: ConfirmBody = parse_body(&body)?;
    let Some(vehicle) = ops::vehicle_info(&api.state, id) else {
        return Err(no_vehicle(id));
    };
    if !confirmation.confirmed {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            json!({
                "error": "Vehicle deletion is permanent. Re-send with {\"confirmed\":true}.",
                "confirm_with": { "confirmed": true },
                "vehicle": vehicle,
                "reusable_knowledge_candidates": ops::knowledge_candidates(&api.state).len(),
            }),
        ));
    }
    if !ops::delete_vehicle_private_data(&api.state, id) {
        return Err(ApiError::msg(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("could not delete private data for vehicle #{id}"),
        ));
    }
    ok(json!({
        "deleted_vehicle_id": id,
        "reusable_knowledge_retained": true,
        "knowledge_candidates": ops::knowledge_candidates(&api.state).len(),
    }))
}

async fn vehicle_modules(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    ok(ops::discovered_modules(&api.state, id))
}

async fn vehicle_evidence_map(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    ok(ops::vehicle_evidence_map(&api.state, id))
}

async fn vehicle_report(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    ok(ops::vehicle_report(&api.state, id))
}

async fn set_vehicle_name(
    State(api): State<Arc<ApiState>>,
    Path(id): Path<i64>,
    body: Bytes,
) -> ApiResult {
    let b: NameBody = parse_required(&body)?;
    ops::set_vehicle_name(&api.state, id, &b.name);
    ok(ops::vehicle_info(&api.state, id))
}

#[derive(Deserialize)]
struct FuelPriceBody {
    price: f64,
}

async fn set_fuel_price(
    State(api): State<Arc<ApiState>>,
    Path(id): Path<i64>,
    body: Bytes,
) -> ApiResult {
    let b: FuelPriceBody = parse_required(&body)?;
    ops::set_fuel_price(&api.state, id, b.price);
    ok(ops::vehicle_info(&api.state, id))
}

async fn module_dids(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    ok(ops::discovered_dids(&api.state, id))
}

// ---------- discovery knowledge layer ----------

fn no_vehicle(id: i64) -> ApiError {
    ApiError::msg(StatusCode::NOT_FOUND, format!("no vehicle #{id}"))
}

async fn vehicle_coverage(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    match ops::coverage(&api.state, id) {
        Some(report) => ok(report),
        None => Err(no_vehicle(id)),
    }
}

async fn vehicle_parked_plan(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    match ops::parked_plan(&api.state, id) {
        Some(plan) => ok(plan),
        None => Err(no_vehicle(id)),
    }
}

async fn vehicle_guided_steps(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    match ops::guided_steps(&api.state, id) {
        Some(steps) => ok(steps),
        None => Err(no_vehicle(id)),
    }
}

async fn vehicle_hypotheses(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    if ops::vehicle_info(&api.state, id).is_none() {
        return Err(no_vehicle(id));
    }
    ok(ops::list_hypotheses(&api.state, id))
}

async fn vehicle_join(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    match ops::join_vehicle(&api.state, id) {
        Some(summary) => ok(summary),
        None => Err(no_vehicle(id)),
    }
}

/// State transition on one hypothesis. A rule violation is a 409 whose body
/// names the rule and the reason, so an agent can explain instead of retry.
/// `evidence_run_ids` carries the verification runs a knowledge-state
/// promotion rests on; the reply echoes them as `evidence`.
async fn patch_hypothesis(
    State(api): State<Arc<ApiState>>,
    Path(id): Path<i64>,
    body: Bytes,
) -> ApiResult {
    let patch: crate::db::HypothesisPatch = parse_required(&body)?;
    if patch.knowledge_state.is_none()
        && patch.vehicle_fit.is_none()
        && patch.activation.is_none()
        && patch.label.is_none()
        && patch.evidence_run_ids.is_none()
    {
        return Err(ApiError::msg(
            StatusCode::BAD_REQUEST,
            "send at least one of knowledge_state, vehicle_fit, activation, label, evidence_run_ids",
        ));
    }
    match ops::patch_hypothesis(&api.state, id, &patch) {
        Ok(Some(row)) => ok(row),
        Ok(None) => Err(ApiError::msg(
            StatusCode::NOT_FOUND,
            format!("no hypothesis #{id}"),
        )),
        // A value outside the vocabulary is a malformed request (400); a
        // real transition rule is a conflict with the row's state (409).
        Err(violation) => {
            let status = if violation.rule == "unknown_state_value" {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::CONFLICT
            };
            Err(ApiError::new(
                status,
                json!({ "error": violation.reason, "rule": violation.rule }),
            ))
        }
    }
}

async fn learning_state(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(json!({ "on": ops::learning_state(&api.state) }))
}

#[derive(Deserialize)]
struct LearningStateBody {
    on: bool,
}

async fn set_learning_state(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let b: LearningStateBody = parse_required(&body)?;
    let disabled = ops::set_learning_state(&api.state, b.on);
    ok(json!({ "on": b.on, "disabled": disabled }))
}

async fn fingerprint_experiment(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(ops::fingerprint_experiment(&api.state))
}

async fn probes(State(api): State<Arc<ApiState>>, Query(q): Query<VehicleQuery>) -> ApiResult {
    ok(ops::list_probes(&api.state, q.vehicle_id))
}

async fn add_probe(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let probe: crate::db::UdsProbe = parse_required(&body)?;
    // An unresolvable module key is a bad request, not a stored row that
    // never answers: say so instead of accepting it.
    let id = ops::add_probe(&api.state, &probe, probe.vehicle_id)
        .map_err(|e| ApiError::msg(StatusCode::BAD_REQUEST, e))?;
    ok(json!({ "id": id }))
}

async fn patch_probe(
    State(api): State<Arc<ApiState>>,
    Path(id): Path<i64>,
    body: Bytes,
) -> ApiResult {
    let patch: Value = parse_required(&body)?;
    let is_decode = [
        "module", "did", "label", "offset", "len", "scale", "bias", "unit",
    ]
    .iter()
    .any(|k| patch.get(k).is_some());
    if is_decode {
        let probe: crate::db::UdsProbe = serde_json::from_value(patch)
            .map_err(|e| ApiError::msg(StatusCode::BAD_REQUEST, format!("invalid probe: {e}")))?;
        if !ops::update_probe_decode(&api.state, id, &probe) {
            return Err(ApiError::msg(
                StatusCode::NOT_FOUND,
                format!("no probe #{id}"),
            ));
        }
    } else if let Some(enabled) = patch.get("enabled").and_then(Value::as_bool) {
        ops::toggle_probe(&api.state, id, enabled);
    } else {
        return Err(ApiError::msg(
            StatusCode::BAD_REQUEST,
            "send {\"enabled\": bool} or the full probe decode fields",
        ));
    }
    ok(json!({ "id": id, "updated": true }))
}

async fn delete_probe(State(api): State<Arc<ApiState>>, Path(id): Path<i64>) -> ApiResult {
    ops::delete_probe(&api.state, id);
    ok(json!({ "id": id, "deleted": true }))
}

async fn cases(State(api): State<Arc<ApiState>>, Query(q): Query<VehicleQuery>) -> ApiResult {
    ok(ops::diagnostic_cases(&api.state, q.vehicle_id))
}

#[derive(Deserialize)]
struct CaseBody {
    vehicle_id: i64,
    complaint: String,
    odometer_km: Option<i64>,
    assigned_to: Option<String>,
}

async fn create_case(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let b: CaseBody = parse_required(&body)?;
    ok(ops::create_diagnostic_case(
        &api.state,
        b.vehicle_id,
        &b.complaint,
        b.odometer_km,
        b.assigned_to.as_deref(),
    )
    .map_err(|e| ApiError::msg(StatusCode::BAD_REQUEST, e))?)
}

async fn setting_get(State(api): State<Arc<ApiState>>, Path(key): Path<String>) -> ApiResult {
    ok(json!({ "key": key, "value": ops::app_setting_get(&api.state, &key) }))
}

#[derive(Deserialize)]
struct SettingBody {
    value: String,
}

async fn setting_set(
    State(api): State<Arc<ApiState>>,
    Path(key): Path<String>,
    body: Bytes,
) -> ApiResult {
    if key == TOKEN_SETTING {
        return Err(ApiError::msg(
            StatusCode::BAD_REQUEST,
            "api_token cannot be changed over the API — delete the row in app_settings and restart",
        ));
    }
    let b: SettingBody = parse_required(&body)?;
    ops::app_setting_set(&api.state, &key, &b.value);
    ok(json!({ "key": key, "value": b.value }))
}

// ---------- adapter profile ----------

async fn adapters(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(json!({ "adapters": ops::list_adapters(&api.state) }))
}

#[derive(Deserialize, Default)]
struct AdapterDiscoverBody {
    seconds: Option<u8>,
}

/// Radios in range that are not paired yet. Blocking for up to 15 s by
/// design — the radio inquiry is the wait — but never on the supervisor:
/// `ops::discover_adapters` runs it on the blocking pool.
async fn adapters_discover(State(_api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let b: AdapterDiscoverBody = if body.is_empty() {
        AdapterDiscoverBody::default()
    } else {
        parse_required(&body)?
    };
    let seconds = b
        .seconds
        .unwrap_or(bluetooth::DEFAULT_DISCOVER_SECONDS)
        .clamp(
            *bluetooth::DISCOVER_SECONDS.start(),
            *bluetooth::DISCOVER_SECONDS.end(),
        );
    let devices = ops::discover_adapters(seconds)
        .await
        .map_err(|e| ApiError::msg(StatusCode::SERVICE_UNAVAILABLE, e))?;
    ok(json!({ "devices": devices }))
}

#[derive(Deserialize)]
struct PairBody {
    addr: String,
    pin: Option<String>,
}

/// Pair the device the user chose. `pin` is optional and normally absent:
/// the attempt goes out without one, which is all Secure Simple Pairing
/// needs and all an already-paired radio needs.
///
/// 409 `{"error": "pin_required"}` is the one recoverable answer — the radio
/// asked for a code, so ask the user and call again with `pin`. 400 with
/// whatever the platform said covers the rest (wrong PIN, out of range,
/// dongle asleep): things the person holding the hardware can act on.
async fn adapters_pair(State(_api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let b: PairBody = parse_required(&body)?;
    let addr = b.addr.trim().to_ascii_lowercase();
    if addr.is_empty() {
        return Err(ApiError::msg(
            StatusCode::BAD_REQUEST,
            "addr is required: the dashed MAC of the device to pair",
        ));
    }
    ops::pair_adapter(addr, b.pin).await.map_err(|failure| {
        if failure.is_pin_required() {
            ApiError::new(
                StatusCode::CONFLICT,
                json!({ "error": bluetooth::PIN_REQUIRED, "detail": failure.message() }),
            )
        } else {
            ApiError::msg(StatusCode::BAD_REQUEST, failure.message())
        }
    })?;
    ok(json!({ "paired": true }))
}

async fn adapter_get(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(ops::adapter_profile(&api.state))
}

/// Partial update: fields omitted from the body keep their current value.
async fn adapter_set(State(api): State<Arc<ApiState>>, body: Bytes) -> ApiResult {
    let current = serde_json::to_value(ops::adapter_profile(&api.state))
        .map_err(|e| ApiError::msg(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let patch: Value = parse_required(&body)?;
    let (Value::Object(mut merged), Value::Object(patch)) = (current, patch) else {
        return Err(ApiError::msg(
            StatusCode::BAD_REQUEST,
            "body must be a JSON object of adapter profile fields",
        ));
    };
    let unknown: Vec<&str> = patch
        .keys()
        .map(String::as_str)
        .filter(|k| !crate::elm::transport::profile::FIELDS.contains(k))
        .collect();
    if !unknown.is_empty() {
        return Err(ApiError::msg(
            StatusCode::BAD_REQUEST,
            format!(
                "unknown adapter profile field(s) {unknown:?}; valid fields are {:?}",
                crate::elm::transport::profile::FIELDS
            ),
        ));
    }
    for (key, value) in patch {
        merged.insert(key, value);
    }
    let profile: crate::elm::transport::AdapterProfile =
        serde_json::from_value(Value::Object(merged)).map_err(|e| {
            ApiError::msg(
                StatusCode::BAD_REQUEST,
                format!("invalid adapter profile: {e}"),
            )
        })?;
    let profile = ops::set_adapter_profile(&api.state, profile)
        .map_err(|e| ApiError::msg(StatusCode::BAD_REQUEST, e))?;
    ok(profile)
}

#[derive(Deserialize)]
struct SyncQuery {
    after_reading_id: Option<i64>,
    limit: Option<i64>,
}

async fn sync_batch(State(api): State<Arc<ApiState>>, Query(q): Query<SyncQuery>) -> ApiResult {
    ok(ops::sync_batch(
        &api.state,
        q.after_reading_id.unwrap_or(0),
        q.limit.unwrap_or(1000),
    ))
}

async fn db_path(State(api): State<Arc<ApiState>>) -> ApiResult {
    ok(json!({ "path": ops::db_path(&api.state) }))
}

// ---------- export ----------

#[derive(Deserialize)]
struct ExportQuery {
    vehicle_id: Option<i64>,
    since_hours: Option<f64>,
}

async fn export_markdown(
    State(api): State<Arc<ApiState>>,
    Query(q): Query<ExportQuery>,
) -> Response {
    let md = ops::ai_context(&api.state, q.vehicle_id, q.since_hours.unwrap_or(168.0));
    ([(header::CONTENT_TYPE, "text/markdown; charset=utf-8")], md).into_response()
}

async fn export_json(State(api): State<Arc<ApiState>>, Query(q): Query<ExportQuery>) -> Response {
    let body = ops::export_json(&api.state, q.vehicle_id, q.since_hours.unwrap_or(168.0));
    ([(header::CONTENT_TYPE, "application/json")], body).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    const TOKEN: &str = "test-token-abc";

    fn test_api() -> (Arc<ApiState>, Arc<Db>) {
        let db = Arc::new(Db::open(std::path::Path::new(":memory:")).expect("in-memory db"));
        let state = Arc::new(AppState::new(db.clone(), "/tmp/test.sqlite3".into()));
        (ApiState::for_tests(state, TOKEN), db)
    }

    async fn call(
        api: &Arc<ApiState>,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder().method(method).uri(path);
        if let Some(t) = token {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        if body.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        let req = builder
            .body(axum::body::Body::from(body.unwrap_or("").to_string()))
            .unwrap();
        let resp = router(api.clone()).oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let value = serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
        (status, value)
    }

    #[tokio::test]
    async fn adapter_profile_round_trips_and_is_validated() {
        let (api, db) = test_api();
        let (status, body) = call(&api, "GET", "/adapter", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["kind"], "elm_serial");
        assert_eq!(body["timing"], "default");

        let (status, body) = call(
            &api,
            "PUT",
            "/adapter",
            Some(TOKEN),
            Some(r#"{"kind": "tcp_elm", "host": "192.168.0.10", "timing": "slow"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["port"], 35000, "omitted fields keep their value");
        assert_eq!(
            db.setting_get("adapter.host").as_deref(),
            Some("192.168.0.10")
        );
        assert_eq!(db.setting_get("adapter.timing").as_deref(), Some("slow"));

        let (status, body) = call(
            &api,
            "PUT",
            "/adapter",
            Some(TOKEN),
            Some(r#"{"kind": "elm_serial", "path": ""}"#),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

        let (status, body) = call(&api, "GET", "/adapters", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body["adapters"].is_array());

        // Review #65: unknown keys are refused, not silently dropped.
        let (status, body) = call(
            &api,
            "PUT",
            "/adapter",
            Some(TOKEN),
            Some(r#"{"hots": "192.168.0.11"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            body["error"].as_str().unwrap_or("").contains("hots"),
            "{body}"
        );

        // Review #65: baud is validated against the serial transport's list.
        let (status, body) = call(
            &api,
            "PUT",
            "/adapter",
            Some(TOKEN),
            Some(r#"{"baud": 12345}"#),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

        // A serial profile with a Bluetooth address round-trips as written.
        let (status, _) = call(
            &api,
            "PUT",
            "/adapter",
            Some(TOKEN),
            Some(r#"{"kind": "elm_serial", "path": "/dev/cu.OBDII", "bt_addr": "AA-BB-CC-DD-EE-FF"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            db.setting_get("adapter.bt_addr").as_deref(),
            Some("aa-bb-cc-dd-ee-ff")
        );
    }

    #[tokio::test]
    async fn health_is_open_but_everything_else_needs_the_token() {
        let (api, _) = test_api();
        let (status, body) = call(&api, "GET", "/health", None, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], true);

        let (status, _) = call(&api, "GET", "/status", None, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        let (status, _) = call(&api, "GET", "/status", Some("wrong"), None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        let (status, _) = call(&api, "GET", "/", Some("wrong"), None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        let (status, body) = call(&api, "GET", "/status", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["state"], "disconnected");
    }

    #[tokio::test]
    async fn clear_routes_are_confirm_gated_before_anything_else() {
        let (api, _) = test_api();
        // No body at all → 409 with a before-state slot, never a write.
        let (status, body) = call(&api, "POST", "/dtc/clear", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["confirm_with"]["confirmed"], true);
        assert!(body.get("before").is_some());

        let (status, _) = call(
            &api,
            "POST",
            "/dtc/clear",
            Some(TOKEN),
            Some(r#"{"confirmed": false}"#),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);

        let (status, body) = call(
            &api,
            "POST",
            "/uds/clear",
            Some(TOKEN),
            Some(r#"{"module": "abs"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["before"]["module"], "abs");

        // Confirmed but no car: the request reaches the connection check and
        // is refused there (503), proving the gate sits in front of it.
        let (status, _) = call(
            &api,
            "POST",
            "/dtc/clear",
            Some(TOKEN),
            Some(r#"{"confirmed": true}"#),
        )
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        let (status, _) = call(
            &api,
            "POST",
            "/uds/clear",
            Some(TOKEN),
            Some(r#"{"module": "abs", "confirmed": true}"#),
        )
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn read_routes_serve_the_database() {
        let (api, db) = test_api();
        let vin = crate::elm::discovery::join::fixtures::verified_vin();
        let (vehicle_id, _) = db.ensure_vehicle(&vin);
        let connection_id = db.start_connection("ELM327 v1.5", "test");
        db.link_connection_vehicle(connection_id, vehicle_id);
        let plan_version = crate::elm::discovery::plan::plan_version(Some(&vin));
        let run_id = db
            .insert_verification_run(
                vehicle_id,
                connection_id,
                &plan_version,
                r#"{"step":"brake"}"#,
            )
            .unwrap();

        let (status, body) = call(&api, "GET", "/vehicles", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body[0]["vin"], vin);

        let path =
            format!("/verification/runs?vehicle_id={vehicle_id}&plan_version={plan_version}");
        let (status, body) = call(&api, "GET", &path, Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body[0]["id"], run_id);
        assert!(
            body[0].get("result_json").is_none(),
            "index must not carry bodies"
        );

        let (status, body) = call(
            &api,
            "GET",
            &format!("/verification/runs/{run_id}"),
            Some(TOKEN),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["result"]["step"], "brake");

        let (status, _) = call(&api, "GET", "/verification/runs/999", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        // Without a live connection there is no profile: only customs.
        let (status, body) = call(&api, "GET", "/uds/modules", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m["source"] == "custom"));
        let (status, body) = call(
            &api,
            "POST",
            "/uds/modules",
            Some(TOKEN),
            Some(r#"{"key": "body", "label": "Body computer", "req": "7A0", "resp": "7A8"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let body_module = body
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["key"] == "body")
            .expect("custom module listed");
        assert_eq!(body_module["source"], "custom");
        assert_eq!(body_module["builtin"], false);
        assert_eq!(body_module["read_service"], "22");
        assert_eq!(body_module["route"]["protocol"], "can11_500");

        // The generated plan for the vehicle, without car traffic: its
        // brand's profile modules, ISO identity DIDs, a versioned plan.
        let (status, body) = call(
            &api,
            "GET",
            &format!("/vehicles/{vehicle_id}/parked-plan"),
            Some(TOKEN),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["plan_version"], plan_version);
        assert!(!body["targets"].as_array().unwrap().is_empty());
        assert!(body["targets"][0]["dids"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["did"] == 0xF187));
        let (status, _) = call(&api, "GET", "/vehicles/999/parked-plan", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    /// A vehicle of a second brand through the router: its own coverage,
    /// its own plan, and no leakage from the first brand's rows.
    #[tokio::test]
    async fn a_second_brand_is_served_in_isolation() {
        let (api, db) = test_api();
        let c4 = crate::elm::discovery::join::fixtures::seed_c4(&db);
        let second = crate::elm::discovery::join::fixtures::seed_second_brand(&db);
        for id in [c4.vehicle_id, second.vehicle_id] {
            let (status, _) = call(
                &api,
                "POST",
                &format!("/vehicles/{id}/join"),
                Some(TOKEN),
                None,
            )
            .await;
            assert_eq!(status, StatusCode::OK);
        }
        let (status, body) = call(
            &api,
            "GET",
            &format!("/vehicles/{}/coverage", second.vehicle_id),
            Some(TOKEN),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["vehicle"]["brand_id"], second.brand_id);
        assert_eq!(body["identified"]["family_matches"], 0);
        assert_eq!(body["decodes"]["inherited_untested"]["count"], 0);
        assert_eq!(body["routes"]["reached"], 2);
        let (_, mine) = call(
            &api,
            "GET",
            &format!("/vehicles/{}/coverage", c4.vehicle_id),
            Some(TOKEN),
            None,
        )
        .await;
        assert_eq!(mine["decodes"]["inherited_untested"]["count"], 16);
        assert_ne!(mine["vehicle"]["brand_id"], body["vehicle"]["brand_id"]);
        let (status, plan) = call(
            &api,
            "GET",
            &format!("/vehicles/{}/parked-plan", second.vehicle_id),
            Some(TOKEN),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(plan["plan_version"]
            .as_str()
            .unwrap()
            .starts_with(&format!("{}-", second.brand_id)));
        let targets = plan["targets"].as_array().unwrap();
        assert!(targets.iter().any(|t| t["read_service"] == "21"));
        assert!(targets.iter().all(|t| t["dids"]
            .as_array()
            .unwrap()
            .iter()
            .all(|d| d["did"] != 0xF080)));
    }

    /// Guided steps are generated from open hypotheses: a baseline before
    /// and after every input, optional nodes for anything that moves the
    /// car, an operator confirmation wherever the gearbox matters, and a
    /// plan version composed from the pack revision.
    #[tokio::test]
    async fn guided_steps_are_generated_from_open_hypotheses() {
        let (api, db) = test_api();
        let seeded = crate::elm::discovery::join::fixtures::seed_c4(&db);
        let vehicle = seeded.vehicle_id;
        let (status, _) = call(&api, "GET", "/vehicles/999/guided-steps", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        // Before the join: a valid, empty tree with the composed version.
        let (status, body) = call(
            &api,
            "GET",
            &format!("/vehicles/{vehicle}/guided-steps"),
            Some(TOKEN),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body["steps"].as_array().unwrap().is_empty());
        let version = body["plan_version"].as_str().unwrap();
        let parked = crate::elm::discovery::plan::plan_version(Some(
            db.vehicle(vehicle).unwrap().vin.as_deref().unwrap(),
        ));
        let (head, rev) = parked.rsplit_once("-v").unwrap();
        assert_eq!(version, format!("{head}-corr-v{rev}"));
        assert_eq!(body["facts"]["gearbox"], "unknown");

        call(
            &api,
            "POST",
            &format!("/vehicles/{vehicle}/join"),
            Some(TOKEN),
            None,
        )
        .await;
        let (_, body) = call(
            &api,
            "GET",
            &format!("/vehicles/{vehicle}/guided-steps"),
            Some(TOKEN),
            None,
        )
        .await;
        let steps = body["steps"].as_array().unwrap();
        assert!(!steps.is_empty());
        assert_eq!(
            steps.len() % 3,
            0,
            "(baseline_before, input, baseline_after)*"
        );
        let mut saw_optional = false;
        for (i, step) in steps.iter().enumerate() {
            let n = i / 3 + 1;
            match i % 3 {
                0 => {
                    assert_eq!(step["id"], format!("baseline_before_{n}"));
                    assert_eq!(step["kind"], "baseline");
                    assert_eq!(step["on_success"], steps[i + 1]["id"]);
                    assert_eq!(step["module"], steps[i + 1]["module"]);
                    assert_eq!(step["capture"]["dids"], steps[i + 1]["capture"]["dids"]);
                }
                2 => {
                    assert_eq!(step["id"], format!("baseline_after_{n}"));
                    assert_eq!(step["kind"], "baseline");
                    assert_eq!(step["module"], steps[i - 1]["module"]);
                    assert_eq!(step["capture"]["dids"], steps[i - 1]["capture"]["dids"]);
                    let next = steps
                        .get(i + 1)
                        .map(|s| s["id"].clone())
                        .unwrap_or(serde_json::Value::Null);
                    assert_eq!(step["on_success"], next, "triplets chain in order");
                }
                _ => {}
            }
            if i % 3 == 1 {
                assert_eq!(step["id"], format!("input_{n}"));
                assert_eq!(step["kind"], "input");
                assert_eq!(steps[i + 1]["kind"], "baseline");
                assert_eq!(step["on_success"], steps[i + 1]["id"]);
                assert!(!step["hypotheses"].as_array().unwrap().is_empty());
                assert!(!step["capture"]["dids"].as_array().unwrap().is_empty());
                let test = step["instruction"].as_str().unwrap().to_ascii_lowercase();
                if test.starts_with("drive") || test.contains("roll") {
                    assert_eq!(step["optional"], true);
                    assert_eq!(step["precondition"]["parked"], false);
                    saw_optional = true;
                } else {
                    assert_eq!(step["optional"], false);
                    assert_eq!(step["precondition"]["parked"], true);
                    assert_eq!(step["success"]["returns_after"], true);
                }
                if test.contains("clutch") {
                    assert_eq!(step["applicable_if"]["gearbox"], "manual");
                    assert!(step["operator_confirmation"].is_string());
                }
                if test.contains("fall") {
                    assert!(step["success"]["expected"]
                        .as_object()
                        .unwrap()
                        .values()
                        .all(|v| v == "monotonic_decrease"));
                }
            }
        }
        // Optional (car-moving) nodes come after the stationary ones.
        let first_optional = steps.iter().position(|s| s["optional"] == true);
        if let Some(pos) = first_optional {
            assert!(saw_optional);
            assert!(steps[pos..]
                .iter()
                .filter(|s| s["kind"] == "input")
                .all(|s| s["optional"] == true));
        }
        // A test that names another module's DID gets it as a reference.
        assert!(steps.iter().any(|s| s["capture"]["reference_dids"]
            .as_object()
            .map(|m| !m.is_empty())
            .unwrap_or(false)));
    }

    /// The knowledge layer end to end through the router: join the seeded
    /// C4, read its coverage and hypotheses, then walk a hypothesis through
    /// the state rules.
    #[tokio::test]
    async fn join_coverage_and_hypothesis_rules_through_the_router() {
        let (api, db) = test_api();
        let c4 = crate::elm::discovery::join::fixtures::seed_c4(&db);
        let vehicle = c4.vehicle_id;

        let (status, _) = call(&api, "GET", "/vehicles/999/coverage", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let (status, _) = call(&api, "POST", "/vehicles/999/join", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let (status, body) = call(
            &api,
            "POST",
            &format!("/vehicles/{vehicle}/join"),
            Some(TOKEN),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["inherited_created"], 16);
        assert_eq!(body["unknown_created"], 5);

        let (status, body) = call(
            &api,
            "GET",
            &format!("/vehicles/{vehicle}/coverage"),
            Some(TOKEN),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "partial");
        assert_eq!(body["decodes"]["inherited_untested"]["count"], 16);
        assert_eq!(body["identified"]["family_matches"], 3);
        assert_eq!(body["learning"]["learning_state_on"], false);

        let (status, body) = call(
            &api,
            "GET",
            &format!("/vehicles/{vehicle}/hypotheses"),
            Some(TOKEN),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let rows = body.as_array().unwrap();
        assert_eq!(rows.len(), 21);
        let d400 = rows
            .iter()
            .find(|h| h["module_id"] == c4.abs && h["did"] == 0xD400)
            .unwrap();
        let id = d400["id"].as_i64().unwrap();
        assert_eq!(d400["vehicle_fit"], "untested");
        assert_eq!(d400["activation"], "disabled");

        // Rule: enabled needs matched → 409 naming the rule.
        let (status, body) = call(
            &api,
            "PATCH",
            &format!("/hypotheses/{id}"),
            Some(TOKEN),
            Some(r#"{"activation": "enabled"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["rule"], "enabled_requires_matched");

        // Rule: learning needs the learning state.
        let (status, body) = call(
            &api,
            "PATCH",
            &format!("/hypotheses/{id}"),
            Some(TOKEN),
            Some(r#"{"activation": "learning"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["rule"], "learning_requires_learning_state");
        let (status, body) = call(
            &api,
            "PUT",
            "/learning-state",
            Some(TOKEN),
            Some(r#"{"on": true}"#),
        )
        .await;
        assert_eq!((status, body["on"].as_bool()), (StatusCode::OK, Some(true)));
        let (status, body) = call(&api, "GET", "/learning-state", Some(TOKEN), None).await;
        assert_eq!((status, body["on"].as_bool()), (StatusCode::OK, Some(true)));
        let (status, body) = call(
            &api,
            "PATCH",
            &format!("/hypotheses/{id}"),
            Some(TOKEN),
            Some(r#"{"activation": "learning"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["activation"], "learning");

        // A value outside the vocabulary is a 400, not a 409.
        let (status, body) = call(
            &api,
            "PATCH",
            &format!("/hypotheses/{id}"),
            Some(TOKEN),
            Some(r#"{"vehicle_fit": "maybe"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["rule"], "unknown_state_value");

        // Switching learning off cascades to every learning hypothesis.
        let (status, body) = call(
            &api,
            "PUT",
            "/learning-state",
            Some(TOKEN),
            Some(r#"{"on": false}"#),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["on"], false);
        assert_eq!(body["disabled"], 1);
        let (_, body) = call(
            &api,
            "GET",
            &format!("/vehicles/{vehicle}/hypotheses"),
            Some(TOKEN),
            None,
        )
        .await;
        assert!(body
            .as_array()
            .unwrap()
            .iter()
            .all(|h| h["activation"] == "disabled"));

        // Confirming on this car unlocks enabled.
        let (status, body) = call(
            &api,
            "PATCH",
            &format!("/hypotheses/{id}"),
            Some(TOKEN),
            Some(r#"{"vehicle_fit": "matched", "activation": "enabled"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["vehicle_fit"], "matched");
        assert_eq!(body["activation"], "enabled");

        let (status, _) = call(
            &api,
            "PATCH",
            &format!("/hypotheses/{id}"),
            Some(TOKEN),
            Some(r#"{}"#),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let (status, _) = call(
            &api,
            "PATCH",
            "/hypotheses/999",
            Some(TOKEN),
            Some(r#"{"label": "x"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let (_, body) = call(
            &api,
            "GET",
            &format!("/vehicles/{vehicle}/coverage"),
            Some(TOKEN),
            None,
        )
        .await;
        assert_eq!(body["decodes"]["matched"]["hypothesis_ids"][0], id);
        assert_eq!(body["decodes"]["enabled"]["count"], 1);
    }

    /// A knowledge-state promotion through the router: what the world knows
    /// only moves on evidence this car actually recorded, and what it moves
    /// to is what the outbound knowledge table carries.
    #[tokio::test]
    async fn promoting_a_hypothesis_needs_evidence_through_the_router() {
        let (api, db) = test_api();
        let c4 = crate::elm::discovery::join::fixtures::seed_c4(&db);
        let vehicle = c4.vehicle_id;
        crate::elm::discovery::join::join_vehicle(&db, crate::elm::uds_map::map(), vehicle);
        // A decode the world does not know yet: the pack's own states
        // arrive through the inherit path and are not what this gate rules on.
        let unknown = db
            .list_hypotheses(vehicle)
            .into_iter()
            .find(|h| h.module_id == c4.abs && h.knowledge_state == "unknown")
            .expect("an unknown hypothesis on the seeded module");
        let (id, did) = (unknown.id, unknown.did);

        let connection = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(connection, vehicle);
        let run = db
            .insert_verification_run(vehicle, connection, "corr-v1", "{}")
            .unwrap();
        // A run belonging to a different car.
        let (other, _) = db.ensure_vehicle("VF7OTHER0000000001");
        let other_connection = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(other_connection, other);
        let other_run = db
            .insert_verification_run(other, other_connection, "corr-v1", "{}")
            .unwrap();

        // Matched, but no discriminating run named.
        let (status, body) = call(
            &api,
            "PATCH",
            &format!("/hypotheses/{id}"),
            Some(TOKEN),
            Some(r#"{"vehicle_fit": "matched", "knowledge_state": "locally_confirmed"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["rule"], "locally_confirmed_requires_evidence");

        // Another vehicle's run.
        let (status, body) = call(
            &api,
            "PATCH",
            &format!("/hypotheses/{id}"),
            Some(TOKEN),
            Some(&format!(
                r#"{{"vehicle_fit": "matched", "knowledge_state": "locally_confirmed", "evidence_run_ids": [{other_run}]}}"#
            )),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["rule"], "evidence_run_not_found");

        // Fleet knowledge is never settable from one car.
        let (status, body) = call(
            &api,
            "PATCH",
            &format!("/hypotheses/{id}"),
            Some(TOKEN),
            Some(&format!(
                r#"{{"vehicle_fit": "matched", "knowledge_state": "community_verified", "evidence_run_ids": [{run}]}}"#
            )),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["rule"], "fleet_state_not_settable_locally");

        // The car's own run carries the promotion, and the reply echoes it.
        let (status, body) = call(
            &api,
            "PATCH",
            &format!("/hypotheses/{id}"),
            Some(TOKEN),
            Some(&format!(
                r#"{{"vehicle_fit": "matched", "knowledge_state": "locally_confirmed", "evidence_run_ids": [{run}]}}"#
            )),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["knowledge_state"], "locally_confirmed");
        assert_eq!(body["evidence"]["run_ids"][0], run);

        let (status, learned) = call(&api, "GET", "/knowledge/candidates", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::OK);
        let confirmed = learned
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["did"] == did && c["knowledge_state"] == "locally_confirmed");
        assert!(confirmed.is_some(), "{learned}");

        // Retracting the claim takes the evidence with it.
        let (status, body) = call(
            &api,
            "PATCH",
            &format!("/hypotheses/{id}"),
            Some(TOKEN),
            Some(r#"{"knowledge_state": "research_candidate"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["knowledge_state"], "research_candidate");
        assert!(body["evidence"].is_null());
    }

    /// Every documented route must be served, and every route the decision
    /// record requires must be documented.
    #[tokio::test]
    async fn openapi_matches_the_router() {
        let (api, _) = test_api();
        let (status, doc) = call(&api, "GET", "/openapi.json", Some(TOKEN), None).await;
        assert_eq!(status, StatusCode::OK);
        let paths = doc["paths"].as_object().unwrap();

        for required in [
            "/health",
            "/openapi.json",
            "/events",
            "/connect",
            "/disconnect",
            "/status",
            "/vehicle/name",
            "/live",
            "/readings",
            "/dtc/scan",
            "/dtc/clear",
            "/ecu-info",
            "/readiness",
            "/sensors",
            "/uds/modules",
            "/uds/modules/{key}",
            "/uds/read",
            "/uds/read-many",
            "/uds/scan",
            "/uds/scan/cancel",
            "/uds/discover",
            "/uds/modules/{key}/dtcs",
            "/uds/clear",
            "/verification/parked",
            "/verification/capture",
            "/verification/runs",
            "/verification/runs/{id}",
            "/vehicles",
            "/vehicles/{id}/modules",
            "/modules/{id}/dids",
            "/vehicles/{id}/evidence-map",
            "/vehicles/{id}/coverage",
            "/vehicles/{id}/hypotheses",
            "/vehicles/{id}/guided-steps",
            "/vehicles/{id}/join",
            "/hypotheses/{id}",
            "/learning-state",
            "/fingerprint-experiment",
            "/probes",
            "/probes/{id}",
            "/export/markdown",
        ] {
            assert!(
                paths.contains_key(required),
                "{required} missing from openapi"
            );
        }

        for route in openapi::ROUTES {
            let concrete = route.path.replace("{id}", "1").replace("{key}", "abs");
            // Status only: /events is an endless SSE stream, so the body is
            // never collected here.
            let req = Request::builder()
                .method(route.method)
                .uri(&concrete)
                .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    route.body.map(|_| "{}").unwrap_or(""),
                ))
                .unwrap();
            let status = router(api.clone()).oneshot(req).await.unwrap().status();
            assert!(
                status != StatusCode::NOT_FOUND || route.path.contains('{'),
                "{} {} documented but not routed",
                route.method,
                route.path
            );
            assert_ne!(
                status,
                StatusCode::METHOD_NOT_ALLOWED,
                "{} {} documented with the wrong method",
                route.method,
                route.path
            );
        }
    }
}
