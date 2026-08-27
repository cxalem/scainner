#!/usr/bin/env python3
"""Convert the checked-in C4 evidence captures to HypothesisInput fixtures.

Usage: scripts/correlation_replay.py --convert

The conversion is deterministic and uses only Python's standard library.
The camera light/lens capture named in the plan was not checked in; its
fixture is reconstructed as repeated readings from the recorded D400-D40A
sweep, matching the workflow's documented all-constant negative result.
"""

import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "apps/desktop/docs/workflows/evidence"
OUT = ROOT / "apps/desktop/src-tauri/tests/fixtures/correlation"


def payload(text):
    return [int(part, 16) for part in text.split()]


def be(value, length, signed=False):
    return list(int(value).to_bytes(length, "big", signed=signed))


def write(name, value):
    # Compact output keeps the replay corpus reviewable as a binary-sized
    # artifact instead of turning each repeated reference into many diff lines.
    (OUT / name).write_text(json.dumps(value, separators=(",", ":")) + "\n")


def input_value(module, did, samples, siblings=None, inherited=None):
    result = {
        "module": module,
        "did": int(did, 16),
        "samples": samples,
        "siblings": siblings or [],
    }
    if inherited is not None:
        result["inherited"] = inherited
    return result


def convert_drive():
    rows = list(csv.DictReader((EVIDENCE / "citroen-c41-drive-v1-2026-08-27.csv").open()))
    cycles = []
    current = None
    for row in rows:
        if row["key"] == "banner":
            continue
        if row["key"] == "D400":
            if current:
                cycles.append(current)
            current = {}
        current[row["key"]] = row["raw"]
    if current:
        cycles.append(current)
    dids = ["D400", "D401", "D402", "D403", "D406", "D40C", "D464", "D46D", "D479"]
    wheel_dids = ["D400", "D401", "D402", "D403"]
    for did in dids:
        samples = []
        siblings = []
        for index, cycle in enumerate(cycles):
            ts = index * 1000
            speed = int(cycle["speed"].replace(" ", ""), 16)
            rpm = int(cycle["rpm"].replace(" ", ""), 16) / 4.0
            voltage = int(cycle["volt"].replace(" ", ""), 16) / 1000.0
            refs = [
                {"key": "speed", "value": speed, "ts_ms": ts},
                {"key": "rpm", "value": rpm, "ts_ms": ts},
                {"key": "voltage", "value": voltage, "ts_ms": ts},
                {
                    "key": "brake_switch",
                    "value": int(cycle["D406"].replace(" ", ""), 16),
                    "ts_ms": ts,
                },
                {
                    "key": "brake_pressure",
                    "value": int(cycle["D40C"].replace(" ", ""), 16),
                    "ts_ms": ts,
                },
            ]
            samples.append({"ts_ms": ts, "payload": payload(cycle[did]), "refs": refs})
            for sibling in wheel_dids:
                siblings.append(
                    {"did": int(sibling, 16), "ts_ms": ts, "payload": payload(cycle[sibling])}
                )
        write(f"drive-{did.lower()}.json", input_value("6AD/68D", did, samples, siblings))


def convert_cornering():
    data = json.loads((EVIDENCE / "c41-session2-turn-2026-08-27-2025.json").read_text())
    dids = ["D400", "D401", "D402", "D403"]
    for did in dids:
        samples = []
        siblings = []
        for index, row in enumerate(data):
            ts = index * 100
            refs = [{"key": "steering_angle", "value": row["angle"], "ts_ms": ts}]
            samples.append(
                {"ts_ms": ts, "payload": be(round(row[did] * 100), 2), "refs": refs}
            )
            for sibling in dids:
                siblings.append(
                    {
                        "did": int(sibling, 16),
                        "ts_ms": ts,
                        "payload": be(round(row[sibling] * 100), 2),
                    }
                )
        write(f"corner-{did.lower()}.json", input_value("6AD/68D", did, samples, siblings))


def convert_vacuum():
    data = json.loads((EVIDENCE / "c41-session2-vacuum-2026-08-27-2031.json").read_text())
    samples = []
    for index, row in enumerate(data):
        ts = index * 500
        refs = [
            {"key": "engine_on", "value": 0.0, "ts_ms": ts},
            {"key": "brake_pedal", "value": float(row["brake"]), "ts_ms": ts},
            {"key": "brake_pressure", "value": float(row["bar"]), "ts_ms": ts},
            {"key": "voltage", "value": float(row["V"]), "ts_ms": ts},
        ]
        samples.append({"ts_ms": ts, "payload": [row["D479"]], "refs": refs})
    write("vacuum-d479.json", input_value("6AD/68D", "D479", samples))


def convert_steering():
    sources = {
        "steering-static": "c41-session3-steering-static-2026-08-27-2107.json",
        "steering-turn": "c41-session3-steering-turn-2026-08-27-2104.json",
    }
    dids = ["D40D", "D40E", "D40F", "D411", "D404"]
    for prefix, filename in sources.items():
        data = json.loads((EVIDENCE / filename).read_text())
        for did in dids:
            samples = []
            for row in data:
                ts = round(float(row["t"]) * 1000)
                samples.append(
                    {
                        "ts_ms": ts,
                        "payload": payload(row[did]),
                        "refs": [
                            {"key": "steering_angle", "value": row["angle"], "ts_ms": ts}
                        ],
                    }
                )
            write(f"{prefix}-{did.lower()}.json", input_value("6B5/695", did, samples))


def convert_camera_negative():
    sweep = json.loads(
        (EVIDENCE / "c41-session3-camera_74a-sweep-D400-D4FF-2026-08-27-2059.json").read_text()
    )
    conditions = [(0, 0), (1, 0), (0, 0), (1, 1), (0, 1), (0, 0)]
    for hit in sweep["hits"]:
        did = hit["did"]
        samples = []
        for index, (lights, lens) in enumerate(conditions):
            ts = index * 1000
            samples.append(
                {
                    "ts_ms": ts,
                    "payload": payload(hit["hex"]),
                    "refs": [
                        {"key": "lights_on", "value": float(lights), "ts_ms": ts},
                        {"key": "lens_covered", "value": float(lens), "ts_ms": ts},
                    ],
                }
            )
        write(f"camera-{did:04x}-constant.json", input_value("74A/64A", f"{did:04X}", samples))


def convert():
    OUT.mkdir(parents=True, exist_ok=True)
    convert_drive()
    convert_cornering()
    convert_vacuum()
    convert_steering()
    convert_camera_negative()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--convert", action="store_true", help="regenerate JSON fixtures")
    args = parser.parse_args()
    if args.convert:
        convert()
    else:
        parser.error("pass --convert")


if __name__ == "__main__":
    main()
