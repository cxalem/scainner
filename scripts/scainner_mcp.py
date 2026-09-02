"""Scainner MCP server: the agent API as tools.

Run with `uv run scripts/scainner_mcp.py` (stdio transport). The desktop
app must be running; it serves the HTTP API on 127.0.0.1:47811 and writes
the bearer token to <app data dir>/api-token, which the client reads.

Every tool is read-only except `dtc_clear` and `uds_clear`, which require
`confirmed=true` and otherwise return the before-state (HTTP 409) — the
same gate the app and the HTTP API apply. Nothing here can write to the
car's configuration (no UDS 2E/2F/31/11/27 exists in the API).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mcp.server.fastmcp import FastMCP  # noqa: E402

from scainner_api import ApiError, Client  # noqa: E402

mcp = FastMCP(
    "scainner",
    instructions=(
        "Tools for talking to the car connected to the Scainner desktop app. "
        "Call `status` first; `connect` if disconnected and wait until state is "
        "'connected'. Prefer `uds_read_many` over repeated single reads. All "
        "reads use each module's read service from the knowledge map (22 / 21 / 1A) in the default session; long operations "
        "(scan, discover, parked_verification, capture) block for minutes."
    ),
)
_client: Client | None = None


def api() -> Client:
    global _client
    if _client is None:
        _client = Client()
    return _client


def guarded(fn):
    """Turn API errors into plain tool results instead of tracebacks."""
    import functools

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ApiError as error:
            return {"error": str(error), "status": error.status}
        except OSError as error:
            return {"error": f"cannot reach the Scainner app API: {error}. Is the desktop app running?"}

    return wrapper


@mcp.tool()
@guarded
def status() -> dict:
    """Connection state, ELM version, resolved VIN / vehicle_id, scanning flag."""
    return api().status()


@mcp.tool()
@guarded
def connect(wait_seconds: int = 120) -> dict:
    """Connect to the dongle (includes the Bluetooth revival cure) and wait until connected."""
    api().connect()
    return api().wait_connected(timeout=wait_seconds)


@mcp.tool()
@guarded
def disconnect() -> dict:
    """Disconnect from the dongle."""
    return api().disconnect() or {"ok": True}


@mcp.tool()
@guarded
def name_vehicle(name: str) -> dict:
    """Name a VIN-less vehicle so evidence can be stored against it."""
    return api().name_vehicle(name)


@mcp.tool()
@guarded
def live() -> dict:
    """Latest live readings (rpm, speed, coolant, ... plus enabled probe values)."""
    return api().live()


@mcp.tool()
@guarded
def readings(key: str, vehicle_id: int | None = None, since_hours: float = 24.0, limit: int | None = 500) -> list | dict:
    """Time series for one reading key (use reading_keys to list them)."""
    return api().readings(key, vehicle_id=vehicle_id, since_hours=since_hours, limit=limit)


@mcp.tool()
@guarded
def reading_keys(vehicle_id: int | None = None) -> list | dict:
    return api().reading_keys(vehicle_id=vehicle_id)


@mcp.tool()
@guarded
def dtc_scan() -> dict:
    """Standard OBD DTC scan: stored/pending/permanent codes, MIL, voltage, freeze frame."""
    return api().dtc_scan()


@mcp.tool()
@guarded
def dtc_clear(confirmed: bool = False) -> dict:
    """Clear standard OBD codes (mode 04). Requires confirmed=true; otherwise returns the before-state."""
    return api().dtc_clear(confirmed=confirmed)


@mcp.tool()
@guarded
def ecu_info() -> dict:
    return api().ecu_info()


@mcp.tool()
@guarded
def sensors() -> list | dict:
    """Read every supported standard PID once."""
    return api().sensors()


@mcp.tool()
@guarded
def uds_modules() -> list | dict:
    """Known module keys with request/response CAN ids (built-in and custom)."""
    return api().uds_modules()


@mcp.tool()
@guarded
def add_uds_module(key: str, label: str, req: str, resp: str) -> dict:
    """Register a custom module route (hex CAN ids, e.g. req='74A', resp='64A')."""
    return api().add_uds_module(key, label, req, resp)


@mcp.tool()
@guarded
def uds_read(module: str, did: int) -> dict | None:
    """Read one identifier with the module's read service. Slow (~1.3 s); prefer uds_read_many."""
    return api().uds_read(module, did)


@mcp.tool()
@guarded
def uds_read_many(module: str, dids: list[int]) -> list | dict:
    """Read up to 64 DIDs with the route set once (~10 Hz). Unanswered DIDs are omitted. Returns did/hex/ascii."""
    return api().uds_read_many(module, dids)


@mcp.tool()
@guarded
def uds_scan(module: str, start: int, end: int) -> list | dict:
    """Range scan (clamped to 256 DIDs per call). Minutes; read-only."""
    return api().uds_scan(module, start, end)


@mcp.tool()
@guarded
def uds_discover(full: bool = False) -> dict:
    """One-button module discovery for the connected vehicle."""
    return api().uds_discover(full=full)


@mcp.tool()
@guarded
def uds_module_dtcs(module: str) -> list | dict:
    """UDS 19 02 fault codes on one module."""
    return api().uds_module_dtcs(module)


@mcp.tool()
@guarded
def uds_clear(module: str, confirmed: bool = False) -> dict:
    """UDS 14 clear on one module. Requires confirmed=true; result includes before/after and the outcome/NRC."""
    return api().uds_clear(module, confirmed=confirmed)


@mcp.tool()
@guarded
def parked_verification() -> dict:
    """Run the current parked plan (identity + bounded sweeps); saves a verification run. Minutes."""
    return api().parked_verification()


@mcp.tool()
@guarded
def capture(req: str, resp: str, dids: list[int], step: str, condition: str, plan_version: str, repeats: int = 3) -> dict:
    """Guided-correlation capture: read `dids` `repeats` times round-robin while the operator holds `condition`. Saved as a run."""
    return api().capture(req, resp, dids, step, condition, plan_version, repeats)


@mcp.tool()
@guarded
def verification_runs(vehicle_id: int | None = None, plan_version: str | None = None, limit: int = 50) -> list | dict:
    return api().verification_runs(vehicle_id=vehicle_id, plan_version=plan_version, limit=limit)


@mcp.tool()
@guarded
def verification_run(run_id: int) -> dict:
    """Full JSON of one evidence run."""
    return api().verification_run(run_id)


@mcp.tool()
@guarded
def vehicles() -> list | dict:
    return api().vehicles()


@mcp.tool()
@guarded
def vehicle_modules(vehicle_id: int) -> list | dict:
    """Discovered modules with fingerprints (part / hardware / software references)."""
    return api().vehicle_modules(vehicle_id)


@mcp.tool()
@guarded
def module_dids(module_id: int) -> list | dict:
    return api().module_dids(module_id)


@mcp.tool()
@guarded
def evidence_map(vehicle_id: int) -> dict:
    return api().evidence_map(vehicle_id)


@mcp.tool()
@guarded
def research_request(vehicle_id: int) -> dict:
    """De-identified "what the car said" for the next deep-research prompt: WMI
    (never the VIN), platform and knowledge keys, module fingerprints (never a
    serial), route outcomes with NRC and attempt counts, unlabeled DIDs with
    byte length and shape class, identity conflicts, open-hypothesis counts and
    generated questions. Local, no car traffic."""
    return api().research_request(vehicle_id)


@mcp.tool()
@guarded
def probes(vehicle_id: int | None = None) -> list | dict:
    """Decode definitions (module, did, offset, len, scale, bias, unit, enabled)."""
    return api().probes(vehicle_id=vehicle_id)


@mcp.tool()
@guarded
def add_probe(vehicle_id: int, module: str, did: int, label: str, unit: str, offset: int = 0, len: int = 1, scale: float = 1.0, bias: float = 0.0) -> dict:  # noqa: A002
    """Add a decode as a disabled probe (enable with toggle_probe once verified)."""
    return api().add_probe(vehicle_id=vehicle_id, module=module, did=did, label=label, unit=unit, offset=offset, len=len, scale=scale, bias=bias)


@mcp.tool()
@guarded
def toggle_probe(probe_id: int, enabled: bool) -> dict:
    return api().toggle_probe(probe_id, enabled)


@mcp.tool()
@guarded
def export_markdown(vehicle_id: int | None = None, since_hours: float = 168.0) -> str | dict:
    """Markdown report of car info, recent scans and sensor stats."""
    return api().export_markdown(vehicle_id=vehicle_id, since_hours=since_hours)


if __name__ == "__main__":
    mcp.run()
