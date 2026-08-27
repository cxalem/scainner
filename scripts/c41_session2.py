#!/usr/bin/env python3
"""Citroën C4 III — on-car session 2, driven entirely through the agent API.

Each subcommand is one test from the protocol's next-actions list. Every
request is read-only except `dtc`, which sends the confirm-gated UDS 14
clear on the engine ECU at the operator's explicit request. Raw evidence
is written to apps/desktop/docs/workflows/evidence/.

  python3 scripts/c41_session2.py connect          # connect + wait
  python3 scripts/c41_session2.py circle 60        # wheel order: slow tight circle
  python3 scripts/c41_session2.py vacuum 40        # D479: engine OFF, ignition on, pump the brake
  python3 scripts/c41_session2.py dtc              # engine DTCs → clear (confirmed) → DTCs, with the outcome
  python3 scripts/c41_session2.py sweep            # ABS D500–D7FF
  python3 scripts/c41_session2.py sweep-module auto_6b5_695 D400 D4FF   # any module, hex range
  python3 scripts/c41_session2.py probes on|off    # steering / clutch / ECU-voltage probes
"""
import csv, json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from scainner_api import Client  # noqa: E402

EVIDENCE = os.path.join(os.path.dirname(__file__), "..", "apps", "desktop", "docs", "workflows", "evidence")
os.makedirs(EVIDENCE, exist_ok=True)
STAMP = time.strftime("%Y-%m-%d-%H%M")
api = Client()

def hexval(hit):
    if not hit or not hit.get("hex"):
        return None
    return int(hit["hex"].replace(" ", ""), 16)

def read(module, did):
    return hexval(api.uds_read(module, did))

def require_connected():
    s = api.status()
    if s.get("state") != "connected":
        print("not connected — run `connect` first"); sys.exit(1)
    return s

def cmd_connect():
    print(json.dumps(api.status()))
    api.connect()
    s = api.wait_connected(timeout=180)
    print(json.dumps(s))

def cmd_circle(seconds=60):
    """Wheel order. Any rolling movement with the wheel turned counts: pull
    out of the parking spot with the wheel on lock, roll 2–3 m, back in with
    the wheel the other way. The outer wheels turn faster; steering angle
    sign (D41F) tells the direction. Speed threshold is 0.5 km/h."""
    require_connected()
    path = os.path.join(EVIDENCE, f"c41-session2-circle-{STAMP}.csv")
    rows = []
    end = time.time() + seconds
    print(f"logging {seconds}s → {path}\n  t      angle°   D400   D401   D402   D403  (km/h)")
    while time.time() < end:
        d = {k: read("abs", v) for k, v in [("D400", 0xD400), ("D401", 0xD401), ("D402", 0xD402), ("D403", 0xD403), ("D41F", 0xD41F)]}
        ang = None if d["D41F"] is None else round(d["D41F"] * 0.1 - 1250, 1)
        spd = {k: (None if d[k] is None else d[k] / 100) for k in ["D400", "D401", "D402", "D403"]}
        row = {"ts": time.strftime("%H:%M:%S"), "angle": ang, **spd}
        rows.append(row)
        print(f"  {row['ts']} {str(ang):>7} " + " ".join(f"{str(spd[k]):>6}" for k in ["D400", "D401", "D402", "D403"]))
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    # Which pair is faster while turning? Left turn = positive angle (full left read +504° on 2026-08-27).
    def mean(xs): return sum(xs) / len(xs) if xs else 0
    # Works at parking speeds: any rolling sample (>0.5 km/h) with the wheel turned >45°.
    for name, sel in [("left turn (angle>+45)", lambda r: (r["angle"] or 0) > 45), ("right turn (angle<-45)", lambda r: (r["angle"] or 0) < -45)]:
        pts = [r for r in rows if sel(r) and all(r[k] for k in ["D400", "D401", "D402", "D403"]) and r["D400"] > 0.5]
        if not pts:
            print(f"{name}: no samples"); continue
        m = {k: mean([r[k] for r in pts]) for k in ["D400", "D401", "D402", "D403"]}
        print(f"{name}: n={len(pts)} mean km/h " + ", ".join(f"{k}={v:.2f}" for k, v in m.items()))
        faster = "D401/D403" if m["D401"] + m["D403"] > m["D400"] + m["D402"] else "D400/D402"
        print(f"  faster pair = {faster} → that pair is the OUTER side of this turn")
    print("Research claim: D400 RL, D401 RR, D402 FL, D403 FR. In a LEFT turn the right side (D401/D403) should be faster.")

def cmd_vacuum(seconds=40):
    """D479 hypothesis: brake-servo vacuum ×5 hPa. Engine OFF, ignition ON.
    Pump the brake pedal firmly 5–6 times during the first 20 s, then leave it."""
    require_connected()
    path = os.path.join(EVIDENCE, f"c41-session2-vacuum-{STAMP}.csv")
    rows = []
    end = time.time() + seconds
    print(f"logging {seconds}s → {path}\n  t        D479  hPa(x5)  brake  pressure  rpm")
    while time.time() < end:
        d479, d406, d40c = read("abs", 0xD479), read("abs", 0xD406), read("abs", 0xD40C)
        live = api.live() or {}
        rpm = live.get("rpm") if isinstance(live, dict) else None
        row = {"ts": time.strftime("%H:%M:%S"), "D479": d479, "hPa": None if d479 is None else d479 * 5, "brake": d406, "pressure": d40c, "rpm": rpm}
        rows.append(row)
        print(f"  {row['ts']} {str(d479):>5} {str(row['hPa']):>8} {str(d406):>6} {str(d40c):>9} {str(rpm):>5}")
        time.sleep(0.3)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    vals = [r["D479"] for r in rows if r["D479"] is not None]
    print(f"D479 range {min(vals)}–{max(vals)}. Vacuum sensor → drops with each pump and does NOT recover while the engine is off.")

def cmd_dtc():
    """Engine ECU: read UDS DTCs, clear (confirmed), read again. Prints the
    full outcome so the NRC / refusal reason is finally recorded."""
    require_connected()
    before = api.uds_module_dtcs("engine")
    print("before:", before)
    print("sending UDS 14 clear on engine (confirmed) …")
    try:
        out = api.uds_clear("engine", confirmed=True)
    except Exception as e:  # noqa: BLE001
        out = {"error": str(e)}
    print("outcome:", json.dumps(out, indent=1))
    after = api.uds_module_dtcs("engine")
    print("after:", after)
    log = api.writes_log(limit=1)
    print("writes_log:", json.dumps(log, indent=1))
    with open(os.path.join(EVIDENCE, f"c41-session2-dtc-clear-{STAMP}.json"), "w") as f:
        json.dump({"before": before, "outcome": out, "after": after, "writes_log": log}, f, indent=1)

def cmd_sweep():
    """ABS D500–D7FF in 256-DID chunks (the API clamps ranges to 256)."""
    require_connected()
    hits = []
    for start in range(0xD500, 0xD800, 0x100):
        end = start + 0xFF
        print(f"scanning {start:04X}–{end:04X} …", flush=True)
        chunk = api.uds_scan("abs", start, end) or []
        for h in chunk:
            print(f"  {h.get('did', 0):04X}  {h.get('hex')}  {h.get('ascii') or ''}")
        hits += chunk
    path = os.path.join(EVIDENCE, f"c41-session2-abs-sweep-D500-D7FF-{STAMP}.json")
    with open(path, "w") as f:
        json.dump({"module": "abs", "range": "D500-D7FF", "hits": hits}, f, indent=1)
    print(f"{len(hits)} answered identifiers → {path}")

def cmd_sweep_module(module, start, end):
    """Generic bounded sweep on any module key (built-in or custom) in 256-DID chunks."""
    require_connected()
    hits = []
    for chunk_start in range(start, end + 1, 0x100):
        chunk_end = min(chunk_start + 0xFF, end)
        print(f"{module}: scanning {chunk_start:04X}–{chunk_end:04X} …", flush=True)
        chunk = api.uds_scan(module, chunk_start, chunk_end) or []
        for h in chunk:
            print(f"  {h.get('did', 0):04X}  {h.get('hex')}  {h.get('ascii') or ''}")
        hits += chunk
    path = os.path.join(EVIDENCE, f"c41-session3-{module}-sweep-{start:04X}-{end:04X}-{STAMP}.json")
    with open(path, "w") as f:
        json.dump({"module": module, "range": f"{start:04X}-{end:04X}", "hits": hits}, f, indent=1)
    print(f"{len(hits)} answered identifiers → {path}")
    return hits

def cmd_probes(state):
    want = state == "on"
    for p in api.probes(vehicle_id=2):
        if p["module"] == "abs" and p["did"] in (0xD41F, 0xD42E, 0xD405):
            api.toggle_probe(p["id"], want)
            print(("enabled " if want else "disabled ") + p["label"])

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(0)
    cmd, rest = args[0], args[1:]
    {
        "connect": lambda: cmd_connect(),
        "circle": lambda: cmd_circle(int(rest[0]) if rest else 60),
        "vacuum": lambda: cmd_vacuum(int(rest[0]) if rest else 40),
        "dtc": lambda: cmd_dtc(),
        "sweep": lambda: cmd_sweep(),
        "sweep-module": lambda: cmd_sweep_module(rest[0], int(rest[1], 16), int(rest[2], 16)),
        "probes": lambda: cmd_probes(rest[0] if rest else "on"),
    }[cmd]()
