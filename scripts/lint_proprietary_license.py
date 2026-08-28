#!/usr/bin/env python3
"""Fail CI if a Scainner workspace becomes publicly publishable or permissive."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = (
    "package.json",
    "apps/desktop/package.json",
    "apps/mobile/package.json",
    "packages/core/package.json",
    "packages/uds-map/package.json",
)


def main() -> int:
    problems: list[str] = []
    licence = (ROOT / "LICENSE").read_text(encoding="utf-8")
    if "Scainner Proprietary License" not in licence or "All rights reserved" not in licence:
        problems.append("LICENSE is not the Scainner proprietary notice")

    for rel in MANIFESTS:
        manifest = json.loads((ROOT / rel).read_text(encoding="utf-8"))
        if manifest.get("private") is not True:
            problems.append(f"{rel}: private must be true")
        if manifest.get("license") != "UNLICENSED":
            problems.append(f"{rel}: license must be UNLICENSED")
        if "publishConfig" in manifest:
            problems.append(f"{rel}: publishConfig is forbidden for private workspaces")

    cargo = (ROOT / "apps/desktop/src-tauri/Cargo.toml").read_text(encoding="utf-8")
    if 'license-file = "../../../LICENSE"' not in cargo:
        problems.append("Cargo.toml must point at the repository proprietary licence")
    if "publish = false" not in cargo:
        problems.append("Cargo.toml must disable crate publication")

    if problems:
        print("proprietary-license policy FAIL")
        for problem in problems:
            print(f"  {problem}")
        return 1
    print("proprietary-license policy OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
