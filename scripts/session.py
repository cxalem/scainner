#!/usr/bin/env python3
"""Brand-agnostic on-car session driver, entirely through the agent API.

Nothing here knows the vehicle: modules, identifiers, decodes, plan version
and evidence path are all resolved at runtime from the running desktop app
(`scripts/scainner_api.py`, apps/desktop/docs/api.md). Every request is
read-only. Evidence lands in
apps/desktop/docs/workflows/evidence/<brand>/<platform>/<plan_version>-<stamp>.json

  python3 scripts/session.py connect                  # POST /connect, wait, print /status
  python3 scripts/session.py plan                     # the generated parked plan
  python3 scripts/session.py run-plan                 # run it, save the report
  python3 scripts/session.py capture 7e0_7e8 "pedal pressed" --dids F187 F190 --repeats 3
  python3 scripts/session.py sweep 7e0_7e8 F100 F1FF  # bounded identifier sweep
  python3 scripts/session.py log 300 --interval 1.0   # round-robin the open hypotheses
  python3 scripts/session.py coverage                 # what is still missing

`<module>` is a `/uds/modules` key, or a `req/resp` / `req_resp` address pair.
Every command accepts `--vehicle-id` (default: `vehicle_id` from `/status`).
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))

REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.realpath(__file__)), ".."))
EVIDENCE_ROOT = os.path.join(REPO, "apps", "desktop", "docs", "workflows", "evidence")
READ_MANY_MAX = 64
STEER_THRESHOLD = 10.0  # decoded steering units beyond which a turn is called


# ---- session context -------------------------------------------------------

class Session:
    """Lazy API client plus the vehicle facts every subcommand needs."""

    def __init__(self, vehicle_id: int | None):
        from scainner_api import Client  # imported late so --help works app-less
        self.api = Client()
        self._vehicle_id = vehicle_id
        self._plan = None
        self._coverage = None

    @property
    def vehicle_id(self) -> int:
        if self._vehicle_id is None:
            vid = self.api.status().get("vehicle_id")
            if vid is None:
                sys.exit("vehicle not identified; run `connect` and name it in the app (or pass --vehicle-id)")
            self._vehicle_id = int(vid)
        return self._vehicle_id

    @property
    def plan(self) -> dict:
        if self._plan is None:
            self._plan = self.api.get(f"/vehicles/{self.vehicle_id}/parked-plan") or {}
        return self._plan

    @property
    def coverage(self) -> dict:
        if self._coverage is None:
            self._coverage = self.api.coverage(self.vehicle_id) or {}
        return self._coverage

    def plan_version(self, correlation: bool = False) -> str:
        v = self.plan.get("plan_version") or "unknown-unknown-v0"
        return v.replace("-v", "-corr-v") if correlation else v

    def require_connected(self):
        s = self.api.status()
        if s.get("state") != "connected":
            sys.exit("not connected; run `connect` first")

    # -- modules / hypotheses --
    def resolve_module(self, spec: str) -> dict:
        """Accept a module key, `req/resp` or `req_resp`; return the /uds/modules entry."""
        want = spec.strip().lower()
        for m in self.api.uds_modules() or []:
            pair = f"{m['req']}/{m['resp']}".lower()
            if want in (m["key"].lower(), pair, pair.replace("/", "_")):
                return m
        sys.exit(f"unknown module {spec!r}; see GET /uds/modules")

    def hypotheses(self, open_only: bool = True) -> list[dict]:
        rows = self.api.hypotheses(self.vehicle_id) or []
        return [h for h in rows if not open_only or h.get("vehicle_fit") != "matched"]

    def open_dids_for(self, module: dict) -> list[int]:
        pair = f"{module['req']}/{module['resp']}".lower()
        return sorted({int(h["did"]) for h in self.hypotheses()
                       if str(h.get("module_address", "")).lower() == pair})

    # -- evidence --
    def save_evidence(self, kind: str, args: dict, result, correlation: bool = False) -> str:
        brand = self.plan.get("brand_id") or self.coverage.get("vehicle", {}).get("brand_id") or "unknown"
        platform = self.plan.get("platform") or "unknown"
        version = self.plan_version(correlation)
        folder = os.path.join(EVIDENCE_ROOT, brand, platform)
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{version}-{time.strftime('%Y-%m-%d-%H%M%S')}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"kind": kind, "vehicle_id": self.vehicle_id, "plan_version": version,
                       "captured_at": iso_now(), "args": args, "result": result}, f, indent=1)
        print(f"evidence -> {os.path.relpath(path, REPO)}")
        return path


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def hex_did(value: str) -> int:
    return int(value.strip().lower().removeprefix("0x"), 16)


def decode(payload_hex: str | None, spec: dict) -> float | None:
    """Apply a hypothesis `decode_json` ({offset, len, scale, bias, signed?}) to a payload."""
    if not payload_hex:
        return None
    try:
        raw = bytes.fromhex(payload_hex.replace(" ", ""))
        off, ln = int(spec.get("offset", 0)), int(spec.get("len", 1))
        chunk = raw[off:off + ln]
        if len(chunk) < ln:
            return None
        n = int.from_bytes(chunk, "big", signed=bool(spec.get("signed", False)))
        return n * float(spec.get("scale", 1)) + float(spec.get("bias", 0))
    except (ValueError, TypeError):
        return None


# ---- subcommands -----------------------------------------------------------

def cmd_connect(a):
    s = Session(a.vehicle_id)
    s.api.connect()
    s.api.wait_connected(timeout=180)
    print(json.dumps(s.api.status(), indent=1))


def cmd_plan(a):
    print(json.dumps(Session(a.vehicle_id).plan, indent=1))


def cmd_run_plan(a):
    s = Session(a.vehicle_id)
    s.require_connected()
    print(f"running parked plan {s.plan_version()} ...", flush=True)
    report = s.api.parked_verification() or {}
    for t in report.get("targets", []):
        obs = t.get("observations", [])
        answered = sum(1 for o in obs if o.get("payload_hex"))
        print(f"  {t.get('key'):<16} {t.get('route', ''):<12} {answered}/{len(obs)} answered  ({t.get('label', '')})")
    s.save_evidence("run-plan", {}, report)


def cmd_capture(a):
    s = Session(a.vehicle_id)
    s.require_connected()
    mod = s.resolve_module(a.module)
    dids = [hex_did(d) for d in a.dids] if a.dids else s.open_dids_for(mod)
    if not dids:
        sys.exit(f"no open hypotheses on {mod['key']}; pass --dids")
    version = s.plan_version(correlation=True)
    step = a.step or a.condition.replace(" ", "_")
    print(f"capture {mod['key']} {len(dids)} DIDs x{a.repeats} under {a.condition!r} ({version})", flush=True)
    result = s.api.capture(mod["req"], mod["resp"], dids, step, a.condition, version, a.repeats)
    for r in (result or {}).get("readings", []):
        print(f"  {r.get('did'):>6}  stable={r.get('stable')}  {(r.get('payloads') or [None])[0]}")
    s.save_evidence("capture", {"module": mod["key"], "dids": [f"{d:04X}" for d in dids], "step": step,
                                "condition": a.condition, "repeats": a.repeats}, result, correlation=True)


def cmd_sweep(a):
    s = Session(a.vehicle_id)
    s.require_connected()
    mod = s.resolve_module(a.module)
    start, end = hex_did(a.start), hex_did(a.end)
    hits = []
    for lo in range(start, end + 1, 0x100):  # the API clamps a scan to 256 identifiers
        hi = min(lo + 0xFF, end)
        print(f"{mod['key']}: scanning {lo:04X}-{hi:04X} ...", flush=True)
        for h in s.api.uds_scan(mod["key"], lo, hi) or []:
            print(f"  {h.get('did', 0):04X}  {h.get('hex')}  {h.get('ascii') or ''}")
            hits.append(h)
    print(f"{len(hits)} answered identifiers")
    s.save_evidence("sweep", {"module": mod["key"], "from": f"{start:04X}", "to": f"{end:04X}"}, hits)


def cmd_log(a):
    s = Session(a.vehicle_id)
    s.require_connected()
    open_h = s.hypotheses()
    groups: dict[str, list[int]] = {}
    for h in open_h:
        groups.setdefault(str(h["module_address"]).lower(), []).append(int(h["did"]))
    if not groups:
        sys.exit("no open hypotheses to log; run `run-plan` first")
    mods = {f"{m['req']}/{m['resp']}".lower(): m for m in s.api.uds_modules() or []}
    missing = [p for p in groups if p not in mods]
    if missing:
        print(f"skipping addresses with no module route: {', '.join(missing)}")
        groups = {p: d for p, d in groups.items() if p in mods}

    steer = next((h for h in open_h if h.get("decode_json") and "steer" in
                  f"{h.get('label') or ''} {h.get('discriminating_test') or ''}".lower()), None)
    steer_spec = None
    if steer:
        try:
            steer_spec = json.loads(steer["decode_json"])
        except ValueError:
            steer_spec = None
    if steer_spec:
        print(f"steering reference: {steer['module_address']} {steer['did']:04X} ({steer.get('label')})")
    else:
        print("no steering hypothesis with a decode on this vehicle: logging without the side/axle split")

    version = s.plan_version(correlation=True)
    out = {"schema": "hypothesis-input-v1", "vehicle_id": s.vehicle_id, "plan_version": version,
           "started_at": iso_now(),
           "modules": {p: {"dids": [f"{d:04X}" for d in sorted(set(ds))]} for p, ds in groups.items()},
           "samples": []}
    stop = {"now": False}
    signal.signal(signal.SIGINT, lambda *_: stop.update(now=True))
    print(f"logging {a.seconds:.0f}s at ~{1 / a.interval:.1f} Hz over {sum(len(d) for d in groups.values())} DIDs; Ctrl-C ends")
    end = time.time() + a.seconds
    while not stop["now"] and time.time() < end:
        t0 = time.time()
        live = (s.api.live() or {}).get("values") or {}
        refs = {k: live[k] for k in ("speed", "rpm", "voltage") if k in live}
        reads = {}
        for pair, dids in groups.items():
            dids = sorted(set(dids))
            got = {}
            for i in range(0, len(dids), READ_MANY_MAX):
                for h in s.api.uds_read_many(mods[pair]["key"], dids[i:i + READ_MANY_MAX]) or []:
                    got[int(h["did"])] = h.get("hex")
            reads[pair] = {f"{d:04X}": got.get(d) for d in dids}
        sample = {"t": iso_now(), "refs": refs, "reads": reads}
        if steer_spec:
            angle = decode(reads.get(str(steer["module_address"]).lower(), {}).get(f"{int(steer['did']):04X}"), steer_spec)
            refs["steering_angle"] = angle
            sample["turn"] = (None if angle is None else "left" if angle > STEER_THRESHOLD
                              else "right" if angle < -STEER_THRESHOLD else "straight")
        out["samples"].append(sample)
        answered = sum(1 for r in reads.values() for v in r.values() if v)
        print(f"  {sample['t'][11:19]} refs={refs} reads={answered} {sample.get('turn', '')}")
        time.sleep(max(0.0, a.interval - (time.time() - t0)))
    print(f"{len(out['samples'])} samples")
    s.save_evidence("log", {"seconds": a.seconds, "interval": a.interval}, out, correlation=True)


def cmd_coverage(a):
    cov = Session(a.vehicle_id).coverage
    print(json.dumps(cov, indent=1))
    remaining = cov.get("remaining") or []
    print(f"status: {cov.get('status')}; remaining: {'; '.join(remaining) if remaining else 'nothing'}")


# ---- CLI -------------------------------------------------------------------

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name, fn, help_):
        sp = sub.add_parser(name, help=help_)
        sp.add_argument("--vehicle-id", type=int, default=None, help="override the vehicle id from /status")
        sp.set_defaults(fn=fn)
        return sp

    add("connect", cmd_connect, "POST /connect, wait for the car, print /status")
    add("plan", cmd_plan, "print the generated parked plan")
    add("run-plan", cmd_run_plan, "run the parked plan and save the report")
    c = add("capture", cmd_capture, "guided-correlation capture on one module")
    c.add_argument("module", help="module key or req/resp address, e.g. 7e0_7e8")
    c.add_argument("condition", help="physical condition label, e.g. 'pedal pressed'")
    c.add_argument("--dids", nargs="+", help="hex DIDs (default: open hypotheses on the module)")
    c.add_argument("--repeats", type=int, default=3)
    c.add_argument("--step", help="step name (default: derived from condition)")
    w = add("sweep", cmd_sweep, "bounded identifier sweep on one module")
    w.add_argument("module")
    w.add_argument("start", help="first DID, hex (e.g. F100)")
    w.add_argument("end", help="last DID, hex (e.g. F1FF)")
    lg = add("log", cmd_log, "round-robin log of the open hypotheses with live references")
    lg.add_argument("seconds", type=float)
    lg.add_argument("--interval", type=float, default=1.0, help="seconds between samples")
    add("coverage", cmd_coverage, "print /coverage and a one-line summary")

    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
