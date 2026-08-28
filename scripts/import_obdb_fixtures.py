#!/usr/bin/env python3
"""Import open-corpus test cases as Scainner replay fixtures (multi-brand plan, P3.1).

    python3 scripts/import_obdb_fixtures.py --corpus <root>           # write fixtures
    python3 scripts/import_obdb_fixtures.py --corpus <root> --check   # byte-identical?

`<root>` is the prepared corpus directory: `<root>/raw/OBDb/<Repo>/` clones
(CC BY-SA 4.0; `COMMIT`, `LICENSE`, `signalsets/v3/*.json`,
`tests/test_cases/<year>/commands/*.yaml`) and `<root>/raw/opendbc/` (MIT;
`COMMIT`, `car/<brand>/fingerprints.py` copies). The selection is
`scripts/SELECTION.json`; the target is `apps/desktop/src-tauri/tests/fixtures`.

For every selected OBDb test-case file the importer

1. reassembles the recorded ISO-TP frames (11-bit or 29-bit CAN id, optional
   extended-address byte) into one application message,
2. decodes every expected signal with OBDb's own semantics (`bix`/`len`/
   `sign`/`mul`/`div`/`add`/`min`/`max`/`blsb`/`map`, data after the service
   echo) and keeps only cases whose recorded `expected_values` reproduce
   exactly; a case that does not verify is skipped and reported,
3. writes an ELM replay (`.../<shape>/elm/<name>.json`, the format
   `ElmDriver::from_replay_json` reads: the addressing commands the app issues
   for that route, then one request/response per case, rendered the way an
   ELM327 prints them with `ATCAF1 ATH0`),
4. writes a `HypothesisInput` (`.../<shape>/correlation/<name>.json`; payload
   = application data after the echoed identifier, one sample per case, no
   references) and a sidecar `<name>.expected.json` with the signal
   definitions, the expected values per sample and the provenance.

opendbc entries are ECU identification payloads without captured framing; the
importer wraps them in synthetic frames and marks `synthetic_framing: true`.

Only the standard library is used. Output is deterministic; `--check` re-runs
the import into memory and fails if any committed file differs.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SELECTION = os.path.join(ROOT, "scripts", "SELECTION.json")
DEFAULT_OUT = os.path.join(ROOT, "apps", "desktop", "src-tauri", "tests", "fixtures")
CC_BY_SA = "CC BY-SA 4.0"
MIT = "MIT"

# ---------------------------------------------------------------------------
# Minimal YAML reader for OBDb test-case files
# ---------------------------------------------------------------------------


def _scalar(text):
    text = text.strip()
    if text in ("", "~", "null"):
        return None
    if text == "true":
        return True
    if text == "false":
        return False
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "'\"":
        return text[1:-1].replace("''", "'")
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        return text


def read_test_case_yaml(path):
    """Return (command_id, [{"expected_values": {...}, "response": str}])."""
    with open(path, encoding="utf-8") as handle:
        lines = handle.read().split("\n")
    command_id = None
    cases = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith("command_id:"):
            command_id = line.split(":", 1)[1].strip()
            if command_id[:1] in "'\"":
                command_id = command_id[1:-1]
        elif line.startswith("- expected_values:") or line.startswith("- response:"):
            case = {"expected_values": {}, "response": None}
            index = _read_case(lines, index, line[2:], case)
            cases.append(case)
            continue
        index += 1
    return command_id, cases


def _read_case(lines, index, first, case):
    """Parse one `- ...` mapping whose first key is on `first`."""
    pending = ["  " + first]
    index += 1
    while index < len(lines) and (lines[index].startswith("  ") or lines[index] == ""):
        pending.append(lines[index])
        index += 1
    cursor = 0
    while cursor < len(pending):
        stripped = pending[cursor].strip()
        if stripped.startswith("expected_values:"):
            rest = stripped.split(":", 1)[1].strip()
            if rest in ("{}", ""):
                cursor += 1
                while cursor < len(pending) and pending[cursor].startswith("    "):
                    key, _, value = pending[cursor].strip().partition(":")
                    case["expected_values"][key.strip()] = _scalar(value)
                    cursor += 1
                continue
        elif stripped.startswith("response:"):
            rest = stripped.split(":", 1)[1].strip()
            if rest in ("|-", "|", ">-", ">"):
                block = []
                cursor += 1
                while cursor < len(pending) and pending[cursor].startswith("    "):
                    block.append(pending[cursor].strip())
                    cursor += 1
                case["response"] = "\n".join(block)
                continue
            case["response"] = _scalar(rest)
        cursor += 1
    return index


# ---------------------------------------------------------------------------
# OBDb signalsets and decoder semantics
# ---------------------------------------------------------------------------


def year_file_score(filename, year):
    """None when the signalset file does not cover `year`; higher = more specific."""
    stem = os.path.splitext(os.path.basename(filename))[0]
    if stem == "default":
        return 0
    match = re.fullmatch(r"(\d{4})?(-)?(\d{4})?", stem)
    if not match:
        return None
    start, dash, end = match.groups()
    if start and end:
        lo, hi = int(start), int(end)
    elif start and dash:
        lo, hi = int(start), 9999
    elif end and dash:
        lo, hi = 0, int(end)
    elif start:
        lo, hi = int(start), int(start)
    else:
        return None
    if lo <= year <= hi:
        return 1 + 1 / (1 + hi - lo)
    return None


def signalset_files(repo_dir, year):
    directory = os.path.join(repo_dir, "signalsets", "v3")
    if not os.path.isdir(directory):
        return []
    scored = []
    for name in sorted(os.listdir(directory)):
        if name.endswith(".json"):
            score = year_file_score(name, year)
            if score is not None:
                scored.append((-score, name))
    scored.sort()
    return [os.path.join(directory, name) for _, name in scored]


def filter_id(data):
    parts = []
    lo, hi = data.get("from"), data.get("to")
    if lo is not None and hi is not None and lo < hi:
        parts.append(f"{lo}-{hi}")
    else:
        if lo is not None:
            parts.append(f"{lo}-")
        if hi is not None:
            parts.append(f"-{hi}")
    years = data.get("years")
    if years:
        parts.extend(str(year) for year in sorted(years))
    return ";".join(parts)


def command_id_of(command):
    """Replicate OBDb `Command.id` for a signalset command."""
    cmd = command["cmd"]
    if "22" in cmd:
        message = "22" + f"{int(str(cmd['22']), 16):04X}"
    elif "21" in cmd:
        message = "21" + f"{int(str(cmd['21']), 16):02X}"
    else:
        message = "01" + f"{int(str(cmd['01']), 16):02X}"
    identifier = command["hdr"]
    if command.get("rax"):
        identifier += "." + command["rax"]
    identifier += "." + message
    parts = []
    if command.get("tmo"):
        parts.append(f"t={int(command['tmo'], 16):02X}")
    if command.get("eax"):
        parts.append(f"e={int(command['eax'], 16):02X}")
    if command.get("tst"):
        parts.append(f"ta={int(command['tst'], 16):02X}")
    if command.get("fcm1"):
        parts.append("fc=1")
    if command.get("proto") == "iso9141_2":
        parts.append("p=9141-2")
    if command.get("pri"):
        parts.append(f"c={int(command['pri'], 16):02X}")
    if command.get("filter"):
        parts.append("f=" + filter_id(command["filter"]))
    if command.get("din") is not None:
        parts.append(f"din={int(command['din'], 16):02X}")
    if command.get("dout") is not None:
        parts.append(f"dout={int(command['dout'], 16):02X}")
    if parts:
        identifier += "|" + ",".join(parts)
    return identifier


class SignalIndex:
    """Signal definitions for one (repo, model year), merged model, brand, SAEJ1979."""

    def __init__(self, obdb_root, repo, year):
        self.files = []
        self.commands = {}
        brand = repo.split("-")[0]
        for candidate in [repo, brand, "SAEJ1979"]:
            directory = os.path.join(obdb_root, candidate)
            if not os.path.isdir(directory):
                continue
            for path in signalset_files(directory, year):
                with open(path, encoding="utf-8") as handle:
                    data = json.load(handle)
                self.files.append(os.path.relpath(path, obdb_root))
                for command in data.get("commands", []):
                    try:
                        identifier = command_id_of(command)
                    except (KeyError, ValueError):
                        continue
                    entry = self.commands.setdefault(identifier, {"command": command, "signals": {}})
                    for signal in command.get("signals", []):
                        entry["signals"].setdefault(signal["id"], signal)

    def lookup(self, command_id):
        return self.commands.get(command_id)


def extract_bits(data, bix, length, blsb):
    if bix + length > len(data) * 8:
        raise ValueError("short data")
    data = bytearray(data)
    if blsb and length > 8:
        start = bix // 8
        end = min(start + (length + 7) // 8, len(data))
        data[start:end] = bytes(reversed(data[start:end]))
    result = 0
    for bit in range(bix, bix + length):
        if data[bit // 8] & (1 << (7 - bit % 8)):
            result |= 1 << (bix + length - bit - 1)
    return result


def decode_signal(fmt, data):
    length = fmt["len"]
    raw = extract_bits(data, fmt.get("bix", 0), length, fmt.get("blsb", False))
    if "map" in fmt:
        entry = fmt["map"].get(str(raw))
        if entry is None:
            return None
        return entry["value"] if isinstance(entry, dict) else str(entry)
    if fmt.get("sign") and raw & (1 << (length - 1)):
        raw -= 1 << length
    value = raw * fmt.get("mul", 1) / fmt.get("div", 1) + fmt.get("add", 0)
    lo, hi = fmt.get("min", 0), fmt["max"]
    if hi > lo:
        value = max(lo, min(value, hi))
    return value


def values_match(expected, actual):
    if isinstance(expected, str) or isinstance(actual, str):
        return str(expected) == str(actual)
    if expected is None or actual is None:
        return expected is None and actual is None
    return abs(float(expected) - float(actual)) <= 1e-6 + 1e-6 * abs(float(expected))


# ---------------------------------------------------------------------------
# ISO-TP reassembly of OBDb responses
# ---------------------------------------------------------------------------


def parse_command_id(command_id):
    head, _, props = command_id.partition("|")
    pieces = head.split(".")
    properties = {}
    for item in props.split(",") if props else []:
        key, _, value = item.partition("=")
        properties[key] = value
    return {
        "hdr": pieces[0],
        "rax": pieces[1] if len(pieces) == 3 else None,
        "service": pieces[-1][:2],
        "parameter": pieces[-1][2:],
        "props": properties,
        "bits29": len(pieces[0]) == 4,
    }


def reassemble(response, bits29, extended):
    """Return the application message from ELM `ATH1`-style frame lines."""
    id_len = 8 if bits29 else 3
    frames = []
    for line in str(response).split("\n"):
        line = line.strip()
        if not line:
            continue
        raw = bytes.fromhex(line[id_len:])
        if extended:
            raw = raw[1:]
        if raw:
            frames.append(raw)
    if not frames:
        raise ValueError("empty response")
    first = frames[0]
    pci = first[0] >> 4
    if pci == 0:
        return first[1 : 1 + (first[0] & 0x0F)]
    if pci != 1:
        raise ValueError("response does not start with a single or first frame")
    length = ((first[0] & 0x0F) << 8) | first[1]
    message = bytearray(first[2:])
    for frame in frames[1:]:
        if frame[0] >> 4 != 2:
            raise ValueError("expected a consecutive frame")
        message.extend(frame[1:])
    if len(message) < length:
        raise ValueError("truncated multi-frame response")
    return bytes(message[:length])


def echo_length(service):
    return 3 if service == "22" else 2


# ---------------------------------------------------------------------------
# ELM rendering (what an ELM327 prints with ATCAF1 ATH0) and route setup
# ---------------------------------------------------------------------------


def hexs(data):
    return " ".join(f"{byte:02X}" for byte in data)


def elm_response(message):
    if len(message) <= 7:
        return hexs(message) + "\r>"
    lines = [f"{len(message):03X}", "0: " + hexs(message[:6])]
    rest = message[6:]
    for index in range(0, len(rest), 7):
        lines.append(f"{index // 7 + 1:X}: " + hexs(rest[index : index + 7]))
    return "\r".join(lines) + "\r>"


def route(parsed):
    """Request/response CAN ids, the app's addressing commands and the address extension."""
    hdr, rax, props = parsed["hdr"], parsed["rax"], parsed["props"]
    extension = int(props["e"], 16) if "e" in props else None
    if parsed["bits29"]:
        priority = int(props.get("c", "18"), 16)
        if "ta" in props:
            # ISO 15765-2 extended format: request hdr<<8|target, response id as recorded.
            target = int(props["ta"], 16)
            request = (priority << 24) | (int(hdr, 16) << 8) | target
            response = (priority << 24) | int(rax, 16)
        else:
            request = (priority << 24) | (int(hdr, 16) << 8) | 0xF1
            if rax is None:
                # `DAxx` header without a recorded receive address: ISO 15765-4
                # physical response 18 DA F1 xx.
                response = (priority << 24) | 0x00DAF100 | (int(hdr, 16) & 0xFF)
            elif int(rax, 16) <= 0xFF:
                response = (priority << 24) | 0x00DAF100 | int(rax, 16)
            else:
                response = (priority << 24) | int(rax, 16)
        commands = [
            "ATSP7",
            "ATCAF1",
            "ATH0",
            f"ATCP {priority:02X}",
            f"ATSH {request & 0xFFFFFF:06X}",
            f"ATCRA {response:08X}",
            f"ATFCSH {request:08X}",
            "ATFCSD 300000",
            "ATFCSM 1",
        ]
        return f"{request:08X}", f"{response:08X}", commands, extension
    request = int(hdr, 16)
    response = int(rax, 16) if rax else request + 8
    commands = [
        "ATSP6",
        "ATCAF1",
        "ATH0",
        f"ATSH {request:03X}",
        f"ATCRA {response:03X}",
        f"ATFCSH {request:03X}",
        f"ATFCSD {extension:02X} 30 00 00" if extension is not None else "ATFCSD 300000",
        "ATFCSM 1",
    ]
    if extension is not None:
        commands.append(f"ATCEA {extension:02X}")
    return f"{request:03X}", f"{response:03X}", commands, extension


def synthetic_frames(message, extension):
    """Split a message into the ISO-TP frames an ECU would send (for opendbc entries)."""
    prefix = bytes([extension]) if extension is not None else b""
    room = 7 - len(prefix)
    if len(message) <= room:
        return [prefix + bytes([len(message)]) + message]
    frames = [prefix + bytes([0x10 | (len(message) >> 8), len(message) & 0xFF]) + message[: room - 1]]
    rest = message[room - 1 :]
    for sequence, index in enumerate(range(0, len(rest), room), start=1):
        frames.append(prefix + bytes([0x20 | (sequence & 0x0F)]) + rest[index : index + room])
    return frames


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


def dumps(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n"


def route_record(parsed, request_id, response_id):
    return {
        "hdr": parsed["hdr"],
        "rax": parsed["rax"],
        "request_id": request_id,
        "response_id": response_id,
        "bits29": parsed["bits29"],
        "props": parsed["props"],
    }


def emit(out_files, entry, name, replay, hypothesis, expected):
    base = os.path.join(entry["brand"], entry["platform"], entry["shape"])
    out_files[os.path.join(base, "elm", name + ".json")] = dumps(replay)
    out_files[os.path.join(base, "correlation", name + ".json")] = dumps(hypothesis)
    out_files[os.path.join(base, "correlation", name + ".expected.json")] = dumps(expected)


def fixture_name(year, parsed):
    props = "".join(f"-{key}{value}" for key, value in sorted(parsed["props"].items()))
    props = re.sub(r"[^0-9a-z-]", "", props.lower())
    return f"{year}-{parsed['hdr'].lower()}-{parsed['service']}{parsed['parameter'].lower()}{props}"


def build_obdb_file(corpus, entry, out_files, report):
    obdb_root = os.path.join(corpus, "raw", "OBDb")
    repo_dir = os.path.join(obdb_root, entry["repo"])
    with open(os.path.join(repo_dir, "COMMIT"), encoding="utf-8") as handle:
        commit = handle.read().strip()
    rel = entry["path"]
    year = int(rel.split("/")[0])
    command_id, cases = read_test_case_yaml(os.path.join(repo_dir, "tests", "test_cases", rel))
    parsed = parse_command_id(command_id)
    if parsed["service"] not in ("21", "22"):
        raise ValueError(f"{entry['repo']} {rel}: only services 21 and 22 are imported")
    if parsed["service"] == "22" and parsed["parameter"].upper()[:2] in ("F1", "F2"):
        raise ValueError(f"{entry['repo']} {rel}: identification DIDs are not imported")
    index = SignalIndex(obdb_root, entry["repo"], year)
    definition = index.lookup(command_id)
    if definition is None:
        raise ValueError(f"{entry['repo']} {rel}: no signalset command matches {command_id}")
    request_id, response_id, commands, extension = route(parsed)
    echo = echo_length(parsed["service"])
    expected_echo = bytes([int(parsed["service"], 16) + 0x40]) + bytes.fromhex(parsed["parameter"])
    command = parsed["service"] + parsed["parameter"].upper()
    max_cases = entry.get("max_cases", 20)
    signals_used = {}
    samples = []
    steps = [{"command": item, "response": "OK\r>"} for item in commands]
    expected_cases = []
    skipped = 0
    seen = set()
    for case in cases:
        if len(samples) >= max_cases:
            break
        try:
            message = reassemble(case["response"], parsed["bits29"], extension is not None)
        except ValueError as error:
            skipped += 1
            report.append(f"skip {entry['repo']} {rel}: {error}")
            continue
        if message[:echo] != expected_echo:
            skipped += 1
            report.append(f"skip {entry['repo']} {rel}: unexpected echo {message[:echo].hex()}")
            continue
        data = message[echo:]
        values = {}
        ok = True
        for signal_id, expected in sorted(case["expected_values"].items()):
            signal = definition["signals"].get(signal_id)
            if signal is None:
                ok = False
                report.append(f"skip {entry['repo']} {rel}: no definition for {signal_id}")
                break
            try:
                actual = decode_signal(signal["fmt"], data)
            except ValueError:
                ok = False
                report.append(f"skip {entry['repo']} {rel}: {signal_id} needs more data")
                break
            if not values_match(expected, actual):
                ok = False
                report.append(
                    f"skip {entry['repo']} {rel}: {signal_id} expected {expected!r} decoded {actual!r}"
                )
                break
            values[signal_id] = expected
            signals_used[signal_id] = signal
        if not ok:
            skipped += 1
            continue
        if entry.get("distinct") and data in seen:
            continue
        seen.add(data)
        steps.append({"command": command, "response": elm_response(message)})
        samples.append({"ts_ms": 1000 * (len(samples) + 1), "payload": list(data), "refs": []})
        expected_cases.append({"values": values})
    if len(samples) < entry.get("min_cases", 1):
        raise ValueError(f"{entry['repo']} {rel}: only {len(samples)} verified cases")
    name = fixture_name(year, parsed)
    provenance = {
        "project": f"OBDb/{entry['repo']}",
        "url": f"https://github.com/OBDb/{entry['repo']}/blob/{commit}/tests/test_cases/{rel}",
        "commit": commit,
        "path": f"tests/test_cases/{rel}",
        "licence": CC_BY_SA,
        "licence_url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "signalsets": [f"OBDb/{path}" for path in index.files],
    }
    replay = {
        "schema_version": 1,
        "name": f"{entry['shape']} replay: {request_id}/{response_id} {command} "
        f"({len(samples)} cases, OBDb/{entry['repo']}@{commit[:12]}, {CC_BY_SA})",
        "contains_vehicle_identifiers": False,
        "steps": steps,
    }
    hypothesis = {
        "module": f"{request_id}/{response_id}",
        "did": int(parsed["parameter"], 16),
        "samples": samples,
        "siblings": [],
    }
    expected = {
        "source": provenance,
        "synthetic_framing": False,
        "service": parsed["service"],
        "parameter": parsed["parameter"].upper(),
        "route": route_record(parsed, request_id, response_id),
        "signals": {
            signal_id: {"name": signal.get("name"), "fmt": signal["fmt"]}
            for signal_id, signal in sorted(signals_used.items())
        },
        "cases": expected_cases,
    }
    emit(out_files, entry, name, replay, hypothesis, expected)
    return {
        "brand": entry["brand"],
        "platform": entry["platform"],
        "shape": entry["shape"],
        "name": name,
        "cases": len(samples),
        "skipped": skipped,
        "provenance": provenance,
        "payload_len": len(samples[0]["payload"]),
    }


# opendbc brand → (request bytes, response echo bytes, stored payload starts with the DID echo)
FW_QUERIES = {
    "toyota": (bytes.fromhex("1A8801"), bytes.fromhex("5A8801"), False),
    "honda": (bytes.fromhex("22F181"), bytes.fromhex("62F181"), False),
    "hyundai": (bytes.fromhex("22F100"), bytes.fromhex("62"), True),
}


def read_fingerprints(path):
    """Yield (platform, ecu, address, subaddress, payload) from an opendbc fingerprints file."""
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    platform = None
    ecu = None
    entries = []
    for line in text.split("\n"):
        stripped = line.strip()
        match = re.match(r"CAR\.(\w+): \{", stripped)
        if match:
            platform = match.group(1)
            continue
        match = re.match(r"\(Ecu\.(\w+), (0x[0-9a-fA-F]+), (None|0x[0-9a-fA-F]+)\): \[", stripped)
        if match:
            ecu = (
                match.group(1),
                int(match.group(2), 16),
                None if match.group(3) == "None" else int(match.group(3), 16),
            )
            continue
        if stripped.startswith("b'") or stripped.startswith('b"'):
            payload = ast.literal_eval(stripped.rstrip(","))
            entries.append((platform, ecu[0], ecu[1], ecu[2], payload))
    return entries


def build_opendbc_file(corpus, entry, out_files, report):
    root = os.path.join(corpus, "raw", "opendbc")
    with open(os.path.join(root, "COMMIT"), encoding="utf-8") as handle:
        commit = handle.read().strip()
    source_brand = entry["source_brand"]
    request, echo, includes_did = FW_QUERIES[source_brand]
    service = f"{request[0]:02X}"
    parameter = request[1:].hex().upper()
    entries = read_fingerprints(os.path.join(root, source_brand, "fingerprints.py"))
    samples = []
    steps = None
    expected_cases = []
    parsed = request_id = response_id = None
    for platform, ecu, address, subaddress, payload in entries:
        if platform != entry["platform_key"] or ecu != entry["ecu"]:
            continue
        text_bytes = payload[2:] if includes_did else payload
        if any(byte != 0 and not 0x20 <= byte <= 0x7E for byte in text_bytes):
            report.append(f"skip opendbc {source_brand} {platform} {ecu}: not printable")
            continue
        if len(samples) >= entry.get("max_cases", 20):
            break
        message = echo + payload
        # The echo is as long as the request (service + parameter bytes).
        data = message[len(request) :]
        if parsed is None:
            if address > 0x7FF:
                parsed = {
                    "hdr": f"{(address >> 8) & 0xFFFF:04X}",
                    "rax": f"{address & 0xFF:02X}",
                    "props": {},
                    "bits29": True,
                }
            else:
                props = {"e": f"{subaddress:02X}"} if subaddress is not None else {}
                parsed = {
                    "hdr": f"{address:03X}",
                    "rax": f"{address + 8:03X}",
                    "props": props,
                    "bits29": False,
                }
            request_id, response_id, commands, extension = route(parsed)
            steps = [{"command": item, "response": "OK\r>"} for item in commands]
        steps.append({"command": request.hex().upper(), "response": elm_response(message)})
        samples.append({"ts_ms": 1000 * (len(samples) + 1), "payload": list(data), "refs": []})
        expected_cases.append(
            {
                "values": {"ascii": data.replace(b"\x00", b"").decode("ascii")},
                "frames": [frame.hex().upper() for frame in synthetic_frames(message, extension)],
            }
        )
    if not samples:
        raise ValueError(f"opendbc {source_brand} {entry['platform_key']} {entry['ecu']}: no usable payload")
    name = f"{entry['ecu'].lower()}-{parsed['hdr'].lower()}-{service.lower()}{parameter.lower()}"
    provenance = {
        "project": "commaai/opendbc",
        "url": f"https://github.com/commaai/opendbc/blob/{commit}/opendbc/car/{source_brand}/fingerprints.py",
        "commit": commit,
        "path": f"opendbc/car/{source_brand}/fingerprints.py",
        "entry": f"CAR.{entry['platform_key']} / Ecu.{entry['ecu']}",
        "licence": MIT,
        "licence_url": f"https://github.com/commaai/opendbc/blob/{commit}/LICENSE",
        "query": entry["query_note"],
    }
    replay = {
        "schema_version": 1,
        "name": f"{entry['shape']} replay: {request_id}/{response_id} {service}{parameter} "
        f"({len(samples)} cases, commaai/opendbc@{commit[:12]}, {MIT}, synthetic framing)",
        "contains_vehicle_identifiers": False,
        "steps": steps,
    }
    hypothesis = {
        "module": f"{request_id}/{response_id}",
        "did": int(parameter[:4], 16),
        "samples": samples,
        "siblings": [],
    }
    expected = {
        "source": provenance,
        "synthetic_framing": True,
        "service": service,
        "parameter": parameter,
        "route": route_record(parsed, request_id, response_id),
        "signals": {"ascii": {"name": "ECU identification string", "fmt": {"unit": "ascii"}}},
        "cases": expected_cases,
    }
    emit(out_files, entry, name, replay, hypothesis, expected)
    return {
        "brand": entry["brand"],
        "platform": entry["platform"],
        "shape": entry["shape"],
        "name": name,
        "cases": len(samples),
        "skipped": 0,
        "provenance": provenance,
        "payload_len": len(samples[0]["payload"]),
    }


def run_import(corpus, selection):
    out_files = {}
    report = []
    summary = []
    for entry in selection["obdb"]:
        summary.append(build_obdb_file(corpus, entry, out_files, report))
    for entry in selection["opendbc"]:
        summary.append(build_opendbc_file(corpus, entry, out_files, report))
    return out_files, summary, report


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--corpus", required=True, help="corpus root containing raw/OBDb and raw/opendbc")
    parser.add_argument("--selection", default=DEFAULT_SELECTION)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--check", action="store_true", help="verify the committed fixtures instead of writing")
    parser.add_argument("--summary", help="write the per-file summary JSON here (input for CORPUS.md)")
    args = parser.parse_args()

    with open(args.selection, encoding="utf-8") as handle:
        selection = json.load(handle)
    out_files, summary, report = run_import(args.corpus, selection)
    for line in report:
        print(line, file=sys.stderr)
    if args.summary:
        with open(args.summary, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, indent=1)

    if args.check:
        failures = 0
        for rel, content in sorted(out_files.items()):
            path = os.path.join(args.out, rel)
            try:
                with open(path, encoding="utf-8") as handle:
                    if handle.read() != content:
                        print(f"DIFFERS {rel}")
                        failures += 1
            except FileNotFoundError:
                print(f"MISSING {rel}")
                failures += 1
        print(f"checked {len(out_files)} files, {failures} differences")
        return 1 if failures else 0

    for rel, content in sorted(out_files.items()):
        path = os.path.join(args.out, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
    total = sum(len(content.encode("utf-8")) for content in out_files.values())
    print(f"wrote {len(out_files)} files ({total} bytes) to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
