#!/usr/bin/env python3
"""Redact identity material from evidence files before they are committed.

Raw captures are private vehicle data (PR #64 split): a VIN, an ECU serial
or a database id must never reach the repository. This tool rewrites a file
in place (or to `--out`) and leaves every other byte untouched — JSON is
edited textually, not re-serialised, so diffs show only the redactions.

    python3 scripts/sanitize_evidence.py <file-or-dir> [...] [--out PATH] [--check]

What is redacted (replaced by "<redacted>"):
- payloads of identity DIDs whose pack field is `vin` or `serial` (the ISO
  block and every brand's `identity_block` in packages/uds-map/data/uds-map.json),
  whether keyed as `"did": 61840`, `"did": "F190"`, `"F190": "..."` or a
  `hex`/`ascii`/`payload_hex`/`printable`/`raw_response` next to the DID;
- any 17-character VIN pattern (ISO 3779 alphabet) anywhere in the text;
- the values of `vin`, `vehicle_id`, `connection_id`, `session_id`,
  `display_name`, `assigned_to`, `owner`, `technician` keys.

`--check` exits 1 when a file still contains any of the above (CI use).
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.realpath(__file__)), ".."))
PACK = os.path.join(REPO, "packages", "uds-map", "data", "uds-map.json")
REDACTED = "<redacted>"
SENSITIVE_FIELDS = {"vin", "serial"}
SENSITIVE_KEYS = ["vin", "vehicle_id", "connection_id", "session_id", "display_name",
                  "assigned_to", "owner", "technician"]
VIN_RE = re.compile(r"(?<![A-HJ-NPR-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-HJ-NPR-Z0-9])")


def identity_dids() -> set[str]:
    """Upper-case hex DIDs whose identity field is a VIN or a serial, from the pack."""
    dids: set[str] = set()
    try:
        with open(PACK, encoding="utf-8") as f:
            pack = json.load(f)
    except OSError:
        return {"F190", "F18C"}
    blocks = [pack.get("standard", {}).get("identity_block")]
    blocks += [b.get("identity_block") for b in pack.get("brands", [])]
    for block in blocks:
        for entry in (block or {}).get("dids", []):
            if entry.get("field") in SENSITIVE_FIELDS and entry.get("did"):
                dids.add(str(entry["did"]).upper())
    return dids or {"F190", "F18C"}


def _did_forms(did_hex: str) -> list[str]:
    n = int(did_hex, 16)
    return [str(n), f'"{did_hex}"', f'"{did_hex.lower()}"', f'"0x{did_hex}"']


def sanitize_text(text: str, dids: set[str]) -> str:
    out = text
    value_keys = "hex|ascii|payload_hex|printable|raw_response|payload|value"
    for did in sorted(dids):
        for form in _did_forms(did):
            # {"did": 61840, "hex": "...", "ascii": "..."} — every value key that
            # follows the did inside the same object.
            pattern = re.compile(
                r'("did"\s*:\s*' + re.escape(form) + r')((?:\s*,\s*"(?:' + value_keys + r')"\s*:\s*"[^"]*")+)',
                re.DOTALL,
            )
            def _sub(m: re.Match) -> str:
                tail = re.sub(r'("(?:' + value_keys + r')"\s*:\s*)"[^"]*"', r'\1"' + REDACTED + '"', m.group(2))
                return m.group(1) + tail
            prev = None
            while prev != out:
                prev = out
                out = pattern.sub(_sub, out)
        # {"F190": "..."} sample maps and {"did": "F190", "payloads": [...]}.
        out = re.sub(r'("' + did + r'"\s*:\s*)"[^"]*"', r'\1"' + REDACTED + '"', out, flags=re.IGNORECASE)
        out = re.sub(r'("did"\s*:\s*"' + did + r'"\s*,\s*"payloads"\s*:\s*)\[[^\]]*\]',
                     r'\1["' + REDACTED + '"]', out, flags=re.IGNORECASE)
    for key in SENSITIVE_KEYS:
        out = re.sub(r'("' + key + r'"\s*:\s*)(?:"[^"]*"|\d+)', r'\1"' + REDACTED + '"', out)
    out = VIN_RE.sub(REDACTED, out)
    return out


def find_leaks(text: str, dids: set[str]) -> list[str]:
    leaks = []
    if VIN_RE.search(text):
        leaks.append("17-character VIN pattern")
    for did in sorted(dids):
        for form in _did_forms(did):
            if re.search(r'"did"\s*:\s*' + re.escape(form) + r'\s*,\s*"(?:hex|ascii|payload_hex)"\s*:\s*"(?!' + REDACTED + ')', text):
                leaks.append(f"payload of identity DID {did}")
                break
    return leaks


def files_under(paths: list[str]) -> list[str]:
    out = []
    for p in paths:
        if os.path.isdir(p):
            for root, _, names in os.walk(p):
                out += [os.path.join(root, n) for n in sorted(names) if n.endswith((".json", ".csv", ".txt", ".md"))]
        else:
            out.append(p)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--out", help="write a single sanitized copy here instead of in place")
    ap.add_argument("--check", action="store_true", help="report leaks, change nothing")
    a = ap.parse_args(argv)
    dids = identity_dids()
    files = files_under(a.paths)
    if a.out and len(files) != 1:
        sys.exit("--out takes exactly one input file")
    status = 0
    for path in files:
        with open(path, encoding="utf-8", errors="surrogateescape") as f:
            text = f.read()
        if a.check:
            leaks = find_leaks(text, dids)
            if leaks:
                status = 1
                print(f"LEAK {path}: {', '.join(leaks)}")
            continue
        clean = sanitize_text(text, dids)
        target = a.out or path
        if clean != text or a.out:
            with open(target, "w", encoding="utf-8", errors="surrogateescape") as f:
                f.write(clean)
            print(f"redacted {os.path.relpath(target, REPO) if target.startswith(REPO) else target}")
        else:
            print(f"clean    {os.path.relpath(path, REPO) if path.startswith(REPO) else path}")
    return status


if __name__ == "__main__":
    sys.exit(main())
