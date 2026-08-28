#!/usr/bin/env python3
"""Convert the checked-in C4 evidence captures to HypothesisInput fixtures.

Usage: scripts/correlation_replay.py --convert

The conversion is deterministic and uses only Python's standard library.
The real camera capture currently lives on PR #53. Pass its path with
--camera-source until that PR is merged; after merge the default path works.
"""

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "apps/desktop/docs/workflows/evidence/psa/c41"
OUT = ROOT / "apps/desktop/src-tauri/tests/fixtures/psa/c41/correlation"
CAMERA_SOURCE = None


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


def clock_ms(text, origin):
    value = datetime.strptime(text, "%H:%M:%S")
    return round((value - origin).total_seconds() * 1000)


def convert_drive():
    rows = list(csv.DictReader((EVIDENCE / "citroen-c41-drive-v1-2026-08-27.csv").open()))
    cycles = []
    current = None
    origin = datetime.strptime(rows[0]["ts"], "%H:%M:%S")
    for row in rows:
        if row["key"] == "banner":
            continue
        if row["key"] == "D400":
            if current:
                cycles.append(current)
            current = {}
        current[row["key"]] = {
            "raw": row["raw"],
            "ts_ms": clock_ms(row["ts"], origin),
        }
    if current:
        cycles.append(current)
    dids = ["D400", "D401", "D402", "D403", "D406", "D40C", "D464", "D46D", "D479"]
    wheel_dids = ["D400", "D401", "D402", "D403"]
    for did in dids:
        samples = []
        siblings = []
        for cycle in cycles:
            ts = cycle[did]["ts_ms"]
            speed = int(cycle["speed"]["raw"].replace(" ", ""), 16)
            rpm = int(cycle["rpm"]["raw"].replace(" ", ""), 16) / 4.0
            voltage = int(cycle["volt"]["raw"].replace(" ", ""), 16) / 1000.0
            refs = [
                {"key": "speed", "value": speed, "ts_ms": cycle["speed"]["ts_ms"]},
                {"key": "rpm", "value": rpm, "ts_ms": cycle["rpm"]["ts_ms"]},
                {"key": "voltage", "value": voltage, "ts_ms": cycle["volt"]["ts_ms"]},
            ]
            samples.append({"ts_ms": ts, "payload": payload(cycle[did]["raw"]), "refs": refs})
            for sibling in wheel_dids:
                siblings.append(
                    {
                        "did": int(sibling, 16),
                        "ts_ms": cycle[sibling]["ts_ms"],
                        "payload": payload(cycle[sibling]["raw"]),
                    }
                )
        write(f"drive-{did.lower()}.json", input_value("6AD/68D", did, samples, siblings))


def convert_cornering():
    data = json.loads((EVIDENCE / "c41-session2-turn-2026-08-27-2025.json").read_text())
    dids = ["D400", "D401", "D402", "D403"]
    for did in dids:
        samples = []
        siblings = []
        for row in data:
            ts = round(float(row["t"]) * 1000)
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
    for row in data:
        ts = round(float(row["t"]) * 1000)
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
    source = CAMERA_SOURCE or EVIDENCE / "c41-session3-camera-lights-2026-08-27.json"
    captures = json.loads(source.read_text())
    dids = sorted(captures[0]["samples"][0])
    for did_text in dids:
        did = int(did_text, 16)
        samples = []
        sequence = 0
        for capture in captures:
            condition = capture["condition"]
            for row in capture["samples"]:
                # The source records order and condition but no timestamps.
                ts = sequence * 1000
                sequence += 1
                samples.append(
                    {
                        "ts_ms": ts,
                        "payload": payload(row[did_text]),
                        "refs": [
                            {"key": f"condition:{condition}", "value": 1.0, "ts_ms": ts}
                        ],
                    }
                )
        write(f"camera-{did:04x}-constant.json", input_value("74A/64A", f"{did:04X}", samples))


def combine_wheel_evidence():
    drive = json.loads((OUT / "drive-d400.json").read_text())
    corner = json.loads((OUT / "corner-d400.json").read_text())
    offset = max(sample["ts_ms"] for sample in drive["samples"]) + 10_000
    for sample in corner["samples"]:
        sample["ts_ms"] += offset
        for reading in sample["refs"]:
            reading["ts_ms"] += offset
    for sibling in corner["siblings"]:
        sibling["ts_ms"] += offset
    drive["samples"].extend(corner["samples"])
    drive["siblings"].extend(corner["siblings"])
    write("combined-d400.json", drive)


def convert():
    OUT.mkdir(parents=True, exist_ok=True)
    convert_drive()
    convert_cornering()
    convert_vacuum()
    convert_steering()
    convert_camera_negative()
    combine_wheel_evidence()


def main():
    global CAMERA_SOURCE
    parser = argparse.ArgumentParser()
    parser.add_argument("--convert", action="store_true", help="regenerate JSON fixtures")
    parser.add_argument("--camera-source", type=Path, help="path to the real camera capture")
    args = parser.parse_args()
    CAMERA_SOURCE = args.camera_source
    if args.convert:
        convert()
    else:
        parser.error("pass --convert")


if __name__ == "__main__":
    main()
