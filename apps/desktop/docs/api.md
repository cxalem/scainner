# Scainner agent API

Everything the desktop app can do against the car and its database is also
served as local HTTP/JSON by the **same running app process**. The server is
started in Tauri `setup`, binds `127.0.0.1:47811`, and calls the exact
functions the UI's Tauri commands call (`src-tauri/src/api/ops.rs`), so the
app and an agent are two clients of one engine: one serial port, one
supervisor loop, one SQLite handle. If the UI shows "connected", the API is
connected; if an agent starts a scan, the UI shows "scanning".

Decision record: personal-hub `1-Projects/Scainner/agent-api.md`.
Protocol context: `docs/product/vehicle-knowledge-acquisition-protocol.md`.

## Finding the server and the token

- **Port**: `47811` by default. Override with the `api_port` row in
  `app_settings` (restart the app). If 47811 is taken the app falls back to
  an ephemeral port and writes it to the `api-port` file below.
- **Token**: generated on first run, stored in `app_settings` (key
  `api_token`) and mirrored, mode 0600, to
  `~/Library/Application Support/com.cxalem.scainner/api-token`
  (the app data dir; next to `scainner.sqlite3`).

```sh
DIR="$HOME/Library/Application Support/com.cxalem.scainner"
TOKEN=$(cat "$DIR/api-token")
PORT=$(cat "$DIR/api-port" 2>/dev/null || echo 47811)
API="http://127.0.0.1:$PORT"
alias sc='curl -sS -H "Authorization: Bearer $TOKEN"'

curl -s $API/health            # the only route without auth
sc $API/                       # plain-text route index
sc $API/openapi.json | jq .    # OpenAPI 3 document
```

The Python client `scripts/scainner_api.py` (stdlib only) does the same
discovery: `python3 scripts/scainner_api.py` prints `/status`.

## Safety rules (identical to the UI)

- Read-only by default. The supervisor has no request that sends UDS
  `2E` (WriteDataByIdentifier), `2F` (IOControl), `31` (RoutineControl),
  `11` (ECUReset) or `27` (SecurityAccess) — the API cannot invent one.
- The only two write-ish routes, `POST /dtc/clear` (OBD mode 04) and
  `POST /uds/clear` (UDS 14), require the JSON body `{"confirmed": true}`.
  Without it they answer **409** with the current state under `before`
  (the DTC scan / the module's stored codes) and nothing is sent to the car.
  Confirmed clears are verified (scan before, clear, scan after) and logged
  in `writes_log` (`GET /writes-log`).
- Long operations (`/uds/scan`, `/uds/discover`, `/verification/*`) block
  the request until done (minutes; the server allows up to 30 min) and pause
  PID polling meanwhile. Watch `GET /events` for progress; `POST
  /uds/scan/cancel` aborts within one DID timeout. Discovery stops itself if
  the engine starts.
- Parked verification and correlation captures refuse to run until the
  vehicle is identified (VIN read) or named (`POST /vehicle/name`), so
  evidence is never filed against the wrong car.

## Errors

JSON `{"error": "..."}` with: `401` bad token, `400` bad body/params,
`404` unknown id, `409` write not confirmed, `503` not connected to the car
(call `POST /connect`, then poll `GET /status` until `state` is
`connected`), `504` the dongle did not answer in time, `500` anything else.

## Routes

`{id}`/`{key}` are path parameters. Query parameters are listed after `?`.

### Meta
| Route | What |
|---|---|
| `GET /health` | `{ok, version, connection}` — no auth |
| `GET /` | plain-text index of every route |
| `GET /openapi.json` | OpenAPI 3 document (kept accurate by a test) |
| `GET /events` | Server-Sent Events: `conn-status`, `live-update`, `uds-scan-progress`, `discovery-progress`, `unknown-brand` — the very Tauri events the UI listens to. `unknown-brand` contains only the WMI/fallback classification, never the full VIN, and discovery continues read-only. |

```sh
sc -N $API/events        # streams: event: live-update\ndata: {"rpm":812,...}
```

### Connection
| Route | What |
|---|---|
| `POST /connect` | start the supervisor (adapter search, Bluetooth sulk-mode cure, keep-alive, 1 Hz polling). Idempotent; returns `/status` |
| `POST /disconnect` | stop it (cancels a running scan first) |
| `GET /status` | `ConnStatus`: `state` (disconnected/connecting/connected), `elm_version`, `detail`, `vin`, `vehicle_id`, `display_name`, `vehicle_is_new`, `scanning` |
| `POST /vehicle/name` `{"name"}` | name the current VIN-less vehicle → `{vehicle_id}` |

```sh
sc -X POST $API/connect
until [ "$(sc $API/status | jq -r .state)" = connected ]; do sleep 2; done
sc $API/status | jq
```

### Standard OBD
| Route | What |
|---|---|
| `GET /live` | last `live-update` broadcast: `{ts_unix_ms, age_ms, values{key: number}}` |
| `GET /readings?key=&vehicle_id=&since=24&limit=` | stored readings of one key (hours window, oldest first, `limit` keeps the newest N) |
| `GET /readings/keys?vehicle_id=` | keys recorded for a vehicle |
| `POST /dtc/scan` | modes 03/07/0A: stored/pending/permanent, MIL, freeze frame |
| `POST /dtc/clear` `{"confirmed": true}` | mode 04, verified before/after — **confirm-gated** |
| `GET /dtc/history?vehicle_id=&limit=20` | past scans |
| `GET /ecu-info` | mode 09: VIN, calibration ids, CVN |
| `GET /readiness` | readiness monitors |
| `GET /sensors` | every supported PID read once |
| `GET /writes-log?vehicle_id=&limit=50` | audit trail of writes |

```sh
sc $API/live | jq .values
sc "$API/readings?vehicle_id=1&key=coolant&since=2&limit=50"
sc -X POST $API/dtc/scan | jq
sc -X POST $API/dtc/clear                          # 409 + before-state
sc -X POST $API/dtc/clear -d '{"confirmed": true}'  # actually clears
```

### UDS
| Route | What |
|---|---|
| `GET /uds/modules` | modules for the connected vehicle: the knowledge map's profile for its VIN (`source: "profile"`, keyed `<req>_<resp>` in lower-case hex, e.g. `7e0_7e8`) plus custom ones (`source: "custom"`); each carries `route` (protocol, ids, target byte, address extension) and `read_service` (`22` / `21` / `1A`). Without an identified connection only customs are listed |
| `POST /uds/modules` `{"key","label","req","resp"}` | add a custom module (hex CAN ids like `"7A0"`/`"7A8"`) |
| `DELETE /uds/modules/{key}` | remove a custom module |
| `POST /uds/read` `{"module","did"}` | read one identifier with the module's read service (per-DID overrides from the map honoured); `null` if the module does not answer |
| `POST /uds/read-many` `{"module","dids":[…]}` | read up to 64 DIDs with the route set once — use this for physical tests; a single `/uds/read` costs ~1.3 s |
| `POST /uds/scan` `{"module","from","to"}` | range scan (DIDs as integers) — minutes |
| `POST /uds/scan/cancel` | abort the running scan / discovery |
| `POST /uds/discover` `{"full": false}` | one-button auto-discovery (`full` = blind sweep) |
| `GET /uds/modules/{key}/dtcs` | fault codes stored on the module (19 02) |
| `POST /uds/clear` `{"module","confirmed": true}` | clear the module's fault memory — **confirm-gated** |

```sh
sc -X POST $API/uds/read -d '{"module":"7e0_7e8","did":61831}'   # 0xF187
sc -X POST $API/uds/scan -d '{"module":"7e0_7e8","from":61824,"to":62079}'
sc $API/uds/modules/7e0_7e8/dtcs
```

### Evidence protocol
| Route | What |
|---|---|
| `POST /verification/parked` | run the parked plan generated from the vehicle's profile (identity block on every reached route with each module's read service, one bounded sweep over the brand's data bands); saves a `verification_runs` row, returns the `ParkedVerificationReport` with `run_id`; `plan_version` is `<brand>-<platform|unknown>-v<n>` |
| `GET /vehicles/{id}/parked-plan` | the plan the generator would run for a vehicle (targets, identity DIDs, sweep bands, budget) — no car traffic |
| `POST /verification/capture` `{"req","resp","dids":[…],"step","condition","plan_version","repeats":3}` | one guided-correlation capture under a labelled physical condition; saves a run, returns the `CorrelationCapture` with `run_id` |
| `GET /verification/runs?vehicle_id=&plan_version=&limit=50` | run index (no bodies), newest first |
| `GET /verification/runs/{id}` | one run with its full `result` JSON |

### Knowledge
| Route | What |
|---|---|
| `GET /vehicles` | every vehicle known locally |
| `GET /vehicles/{id}` | one vehicle row |
| `GET /vehicles/{id}/modules` | discovered modules with DID counts and ECU fingerprints |
| `GET /modules/{id}/dids` | discovered DIDs of one module (`discovered_modules.id`) |
| `GET /vehicles/{id}/evidence-map` | evidence-only topology |
| `GET /vehicles/{id}/report` | per-vehicle report |
| `POST /vehicles/{id}/name` `{"name"}` / `POST /vehicles/{id}/fuel-price` `{"price"}` | edit a stored vehicle |
| `GET /fingerprint-experiment` | local, VIN-free fingerprint cohort measurement |
| `GET /probes?vehicle_id=` | decode definitions polled live |
| `POST /probes` `{vehicle_id, module, did, label, unit, offset, len, scale, bias}` | add a probe → `{id}` |
| `PATCH /probes/{id}` | `{"enabled": false}` toggles; any decode field (`module`,`did`,`label`,`unit`,`offset`,`len`,`scale`,`bias`) replaces the decode (send the full set) |
| `DELETE /probes/{id}` | remove |
| `GET /cases?vehicle_id=` / `POST /cases` `{vehicle_id, complaint, odometer_km?, assigned_to?}` | diagnostic cases |
| `GET /settings/{key}` / `PUT /settings/{key}` `{"value"}` | `app_settings` (writing `api_token` is refused). `auto_discovery` = `off` skips the automatic census → identity → join → coverage run on connect (default on; progress on `/events` as `discovery-progress` phases `auto-census`, `auto-identity`, `auto-join`, `auto-done`; the summary is saved as a `verification_runs` row with `plan_version` `auto-s1-s3`) |
| `GET /sync/batch?after_reading_id=0&limit=1000` | cloud-sync batch |
| `GET /db-path` | where the SQLite file is |

### Export
| Route | What |
|---|---|
| `GET /export/markdown?vehicle_id=&since_hours=168` | markdown briefing (text/markdown) |
| `GET /export/json?vehicle_id=&since_hours=168` | everything in a window as JSON |

## Worked example: an agent runs a correlation capture and reads the diff

Goal: find which ABS DIDs change when the brake pedal is pressed on a parked
car (protocol step "A→B→A": baseline, condition, baseline again).

```sh
# 1. Connect and wait for identity.
sc -X POST $API/connect
until [ "$(sc $API/status | jq -r .state)" = connected ]; do sleep 2; done
VID=$(sc $API/status | jq -r .vehicle_id)
[ "$VID" = null ] && VID=$(sc -X POST $API/vehicle/name -d '{"name":"Grey C4"}' | jq .vehicle_id)

# 2. Capture the same DIDs three times under three conditions.
cap() {  # $1 step, $2 condition
  sc -X POST $API/verification/capture -d "{
    \"req\":\"6A0\",\"resp\":\"68A\",\"dids\":[54272,54273,54274,54275,54282],
    \"step\":\"$1\",\"condition\":\"$2\",\"plan_version\":\"<brand>-<platform>-v1\",\"repeats\":3}"
}
A1=$(cap baseline "pedal released")        # ask the operator to hold each condition
B=$(cap brake "brake pedal pressed")
A2=$(cap baseline "pedal released again")

# 3. Diff. Each capture has readings[] = {did, payloads: [hex|null per repeat],
#    stable, outcome}. A DID is a candidate when it was stable in both captures
#    and its payload differs between them.
diff_dids() {
  jq -n --argjson a "$1" --argjson b "$2" '
    ($a.readings | map({key: .did, value: .}) | from_entries) as $A
    | [ $b.readings[]
        | . as $r | $A[$r.did] as $base
        | select($base != null and $base.stable and $r.stable
                 and $base.payloads[0] != $r.payloads[0])
        | {did: $r.did, baseline: $base.payloads[0], condition: $r.payloads[0]} ]'
}
diff_dids "$A1" "$B"    # DIDs that changed when the pedal was pressed
diff_dids "$A1" "$A2"   # should be empty: anything here is noise, not signal

# 4. Everything was saved: list and re-read the runs later.
sc "$API/verification/runs?vehicle_id=$VID&plan_version=<brand>-<platform>-v1" | jq
sc $API/verification/runs/$(echo "$B" | jq .run_id) | jq .result
```

The same flow in Python:

```python
from scripts.scainner_api import Client
c = Client()                      # reads api-token / api-port from the app data dir
c.connect(); c.wait_connected()
dids = [0xD400, 0xD401, 0xD402, 0xD403, 0xD40A]
a1 = c.capture("6A0", "68A", dids, "baseline", "pedal released", "<brand>-<platform>-v1")
input("press and hold the brake pedal, then Enter")
b  = c.capture("6A0", "68A", dids, "brake", "brake pedal pressed", "<brand>-<platform>-v1")
a2 = c.capture("6A0", "68A", dids, "baseline", "pedal released again", "<brand>-<platform>-v1")
print(c.diff_captures(a1, b))     # {did: (baseline payloads, condition payloads)}
print(c.diff_captures(a1, a2))    # noise floor — should be {}
```

## Implementation notes

- `src-tauri/src/api/ops.rs`: the shared operations (the Tauri commands in
  `lib.rs` and the handlers in `api/mod.rs` are both one-liners over it).
- `src-tauri/src/api/mod.rs`: axum router, bearer auth, confirm gate, SSE
  relay (`app.listen` on the Tauri events → broadcast channel).
- `src-tauri/src/api/openapi.rs`: the route table + OpenAPI document. A test
  hits every documented route through the router and fails on 404/405.
- Tests: `cargo test api::`.


## MCP server (agents)

`scripts/scainner_mcp.py` exposes every route above as MCP tools over stdio
(`uv run scripts/scainner_mcp.py`; the repo's `.mcp.json` registers it as
`scainner` for Claude Code). It uses the same token discovery as the Python
client and the same confirm gate on `dtc_clear` / `uds_clear`.

## Probe polling interval

The supervisor polls enabled probes every `probe_interval_ticks` ticks (one
tick ≈ 250 ms; default 120 ≈ 30–60 s, minimum 4 ≈ 1 s, maximum 2400). Set it
with `PUT /settings/probe_interval_ticks {"value": "8"}` before a physical
test and put it back afterwards; the change applies within ~10 s without
reconnecting. Lower intervals add UDS traffic on every polled module.
