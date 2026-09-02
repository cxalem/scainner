#!/usr/bin/env python3
"""Tiny stdlib-only client for the Scainner agent API (apps/desktop/docs/api.md).

The desktop app must be running: it serves http://127.0.0.1:47811 from the
same process that owns the serial port, so this client shares the app's one
connection to the car. Token and port are read from the app data dir.

    python3 scripts/scainner_api.py            # prints GET /status
    python3 scripts/scainner_api.py /vehicles  # GET any path

    from scripts.scainner_api import Client
    c = Client(); c.connect(); c.wait_connected(); print(c.live())
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

APP_DATA_DIR = os.path.expanduser("~/Library/Application Support/com.cxalem.scainner")
DEFAULT_PORT = 47811


class ApiError(Exception):
    def __init__(self, status: int, body):
        super().__init__(f"HTTP {status}: {body}")
        self.status = status
        self.body = body


class NotConfirmed(ApiError):
    """A write route refused because confirmed=True was not sent; `.body['before']`
    carries the current state to review."""


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


class Client:
    def __init__(self, base: str | None = None, token: str | None = None,
                 timeout: float = 40 * 60, data_dir: str = APP_DATA_DIR):
        self.token = token or os.environ.get("SCAINNER_API_TOKEN") or _read(os.path.join(data_dir, "api-token"))
        if not self.token:
            raise RuntimeError(f"no API token: start the Scainner app once, or set SCAINNER_API_TOKEN ({data_dir}/api-token)")
        port = os.environ.get("SCAINNER_API_PORT") or _read(os.path.join(data_dir, "api-port")) or DEFAULT_PORT
        self.base = (base or f"http://127.0.0.1:{port}").rstrip("/")
        self.timeout = timeout  # long: scans and verification plans take minutes

    # ---- transport ----
    def request(self, method: str, path: str, body=None, params: dict | None = None):
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
                ctype = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                parsed = json.loads(raw)
            except ValueError:
                parsed = raw.decode(errors="replace")
            raise (NotConfirmed if e.code == 409 else ApiError)(e.code, parsed) from None
        if "json" in ctype:
            return json.loads(raw) if raw else None
        return raw.decode()

    def get(self, path, **params):
        return self.request("GET", path, params=params or None)

    def post(self, path, body=None):
        return self.request("POST", path, body=body if body is not None else {})

    # ---- meta ----
    def health(self): return self.get("/health")
    def index(self): return self.get("/")
    def openapi(self): return self.get("/openapi.json")

    def events(self):
        """Yield (event_name, payload) from GET /events (SSE) until the connection drops."""
        req = urllib.request.Request(self.base + "/events")
        req.add_header("Authorization", f"Bearer {self.token}")
        with urllib.request.urlopen(req, timeout=None) as resp:
            name, data = None, []
            for line in resp:
                line = line.decode().rstrip("\n")
                if line.startswith("event:"):
                    name = line[6:].strip()
                elif line.startswith("data:"):
                    data.append(line[5:].strip())
                elif line == "" and data:
                    try:
                        payload = json.loads("\n".join(data))
                    except ValueError:
                        payload = "\n".join(data)
                    yield name, payload
                    name, data = None, []

    # ---- connection ----
    def connect(self): return self.post("/connect")
    def disconnect(self): return self.post("/disconnect")
    def status(self): return self.get("/status")
    def name_vehicle(self, name: str): return self.post("/vehicle/name", {"name": name})

    def wait_connected(self, timeout: float = 120.0, poll: float = 2.0) -> dict:
        deadline = time.time() + timeout
        while True:
            s = self.status()
            if s.get("state") == "connected":
                return s
            if time.time() > deadline:
                raise TimeoutError(f"not connected after {timeout}s: {s}")
            time.sleep(poll)

    # ---- standard OBD ----
    def live(self): return self.get("/live")
    def readings(self, key: str, vehicle_id=None, since_hours=24.0, limit=None):
        return self.get("/readings", key=key, vehicle_id=vehicle_id, since=since_hours, limit=limit)
    def reading_keys(self, vehicle_id=None): return self.get("/readings/keys", vehicle_id=vehicle_id)
    def dtc_scan(self): return self.post("/dtc/scan")
    def dtc_clear(self, confirmed: bool = False):
        return self.post("/dtc/clear", {"confirmed": confirmed})
    def dtc_history(self, vehicle_id=None, limit=20): return self.get("/dtc/history", vehicle_id=vehicle_id, limit=limit)
    def ecu_info(self): return self.get("/ecu-info")
    def readiness(self): return self.get("/readiness")
    def sensors(self): return self.get("/sensors")
    def writes_log(self, vehicle_id=None, limit=50): return self.get("/writes-log", vehicle_id=vehicle_id, limit=limit)

    # ---- UDS ----
    def uds_modules(self): return self.get("/uds/modules")
    def add_uds_module(self, key, label, req, resp):
        return self.post("/uds/modules", {"key": key, "label": label, "req": req, "resp": resp})
    def delete_uds_module(self, key): return self.request("DELETE", f"/uds/modules/{key}")
    def uds_read(self, module: str, did: int): return self.post("/uds/read", {"module": module, "did": did})
    def uds_read_many(self, module: str, dids: list[int]):
        """Read up to 64 DIDs with the route configured once (~10 Hz per DID). Returns hits only."""
        return self.post("/uds/read-many", {"module": module, "dids": list(dids)})
    def uds_scan(self, module: str, start: int, end: int):
        return self.post("/uds/scan", {"module": module, "from": start, "to": end})
    def uds_scan_cancel(self): return self.post("/uds/scan/cancel")
    def uds_discover(self, full: bool = False): return self.post("/uds/discover", {"full": full})
    def uds_module_dtcs(self, module: str): return self.get(f"/uds/modules/{module}/dtcs")
    def uds_clear(self, module: str, confirmed: bool = False):
        return self.post("/uds/clear", {"module": module, "confirmed": confirmed})

    # ---- evidence protocol ----
    def parked_verification(self): return self.post("/verification/parked")
    def capture(self, req: str, resp: str, dids: list[int], step: str, condition: str,
                plan_version: str, repeats: int = 3):
        return self.post("/verification/capture", {
            "req": req, "resp": resp, "dids": list(dids), "step": step,
            "condition": condition, "plan_version": plan_version, "repeats": repeats})
    def verification_runs(self, vehicle_id=None, plan_version=None, limit=50):
        return self.get("/verification/runs", vehicle_id=vehicle_id, plan_version=plan_version, limit=limit)
    def verification_run(self, run_id: int): return self.get(f"/verification/runs/{run_id}")

    @staticmethod
    def diff_captures(baseline: dict, condition: dict) -> dict:
        """DIDs whose payload changed between two captures: {did: (baseline, condition)}.
        Only DIDs stable (identical across repeats) in BOTH captures count, so a
        drifting counter is not mistaken for a signal."""
        base = {r["did"]: r for r in baseline["readings"]}
        out = {}
        for r in condition["readings"]:
            b = base.get(r["did"])
            if not b or not b["stable"] or not r["stable"]:
                continue
            if b["payloads"][0] != r["payloads"][0]:
                out[r["did"]] = (b["payloads"][0], r["payloads"][0])
        return out

    # ---- knowledge ----
    def vehicles(self): return self.get("/vehicles")
    def vehicle(self, vehicle_id: int): return self.get(f"/vehicles/{vehicle_id}")
    def vehicle_modules(self, vehicle_id: int): return self.get(f"/vehicles/{vehicle_id}/modules")
    def module_dids(self, module_id: int): return self.get(f"/modules/{module_id}/dids")
    def evidence_map(self, vehicle_id: int): return self.get(f"/vehicles/{vehicle_id}/evidence-map")
    def vehicle_report(self, vehicle_id: int): return self.get(f"/vehicles/{vehicle_id}/report")
    def set_vehicle_name(self, vehicle_id: int, name: str):
        return self.post(f"/vehicles/{vehicle_id}/name", {"name": name})
    def set_fuel_price(self, vehicle_id: int, price: float):
        return self.post(f"/vehicles/{vehicle_id}/fuel-price", {"price": price})
    def fingerprint_experiment(self): return self.get("/fingerprint-experiment")
    def probes(self, vehicle_id=None): return self.get("/probes", vehicle_id=vehicle_id)
    def add_probe(self, **probe): return self.post("/probes", probe)
    def toggle_probe(self, probe_id: int, enabled: bool):
        return self.request("PATCH", f"/probes/{probe_id}", {"enabled": enabled})
    def update_probe(self, probe_id: int, **probe):
        return self.request("PATCH", f"/probes/{probe_id}", probe)
    def delete_probe(self, probe_id: int): return self.request("DELETE", f"/probes/{probe_id}")
    def cases(self, vehicle_id=None): return self.get("/cases", vehicle_id=vehicle_id)
    def create_case(self, vehicle_id: int, complaint: str, odometer_km=None, assigned_to=None):
        return self.post("/cases", {"vehicle_id": vehicle_id, "complaint": complaint,
                                    "odometer_km": odometer_km, "assigned_to": assigned_to})
    def setting(self, key: str): return self.get(f"/settings/{key}")
    def set_setting(self, key: str, value: str): return self.request("PUT", f"/settings/{key}", {"value": value})
    def sync_batch(self, after_reading_id=0, limit=1000):
        return self.get("/sync/batch", after_reading_id=after_reading_id, limit=limit)
    def db_path(self): return self.get("/db-path")

    # ---- discovery knowledge layer (Universal Discovery Protocol S3 + coverage) ----
    def join_vehicle(self, vehicle_id: int):
        """S3 join: match fingerprinted modules to ecu_families and register inherited
        + unknown hypotheses. Local and idempotent; the car need not be connected."""
        return self.post(f"/vehicles/{vehicle_id}/join")
    def coverage(self, vehicle_id: int): return self.get(f"/vehicles/{vehicle_id}/coverage")
    def hypotheses(self, vehicle_id: int): return self.get(f"/vehicles/{vehicle_id}/hypotheses")
    def research_request(self, vehicle_id: int):
        """De-identified evidence for the next research round: WMI (never the
        VIN), module fingerprints (never a serial), route outcomes, unlabeled
        DIDs and the questions they raise."""
        return self.get(f"/vehicles/{vehicle_id}/research-request")
    def parked_plan(self, vehicle_id: int): return self.get(f"/vehicles/{vehicle_id}/parked-plan")
    def guided_steps(self, vehicle_id: int):
        """The guided-correlation state tree generated from the vehicle's open
        hypotheses (protocol section 9); `steps[]` alternate baseline/input."""
        return self.get(f"/vehicles/{vehicle_id}/guided-steps")
    def patch_hypothesis(self, hypothesis_id: int, **fields):
        """Any of knowledge_state / vehicle_fit / activation / label. A refused
        transition raises NotConfirmed (409) with .body['rule'] naming the rule."""
        return self.request("PATCH", f"/hypotheses/{hypothesis_id}", fields)
    def learning_state(self): return self.get("/learning-state")
    def set_learning_state(self, on: bool): return self.request("PUT", "/learning-state", {"on": on})

    # ---- export ----
    def export_markdown(self, vehicle_id=None, since_hours=168.0):
        return self.get("/export/markdown", vehicle_id=vehicle_id, since_hours=since_hours)
    def export_json(self, vehicle_id=None, since_hours=168.0):
        return self.get("/export/json", vehicle_id=vehicle_id, since_hours=since_hours)


if __name__ == "__main__":
    client = Client()
    path = sys.argv[1] if len(sys.argv) > 1 else "/status"
    result = client.get(path)
    print(json.dumps(result, indent=2) if not isinstance(result, str) else result)
