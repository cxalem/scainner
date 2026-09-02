#!/usr/bin/env python3
"""Brand-token lint (Lint 0 of the multi-brand plan).

Brand and vehicle names belong in pack data (`packages/uds-map/data`), not in
code. This script counts brand/vehicle tokens in the desktop app's source and
compares the per-file counts with `scripts/brand_token_baseline.json`.

    python3 scripts/lint_brand_tokens.py            # check against the baseline
    python3 scripts/lint_brand_tokens.py --update   # rewrite the baseline (only

It fails when any file's count is above its baseline, or when a file that is
not in the baseline contains tokens. It prints the diff either way.

THE BASELINE MAY ONLY SHRINK. Do not raise a count or add a file to
`brand_token_baseline.json` to make a PR pass: move the fact into the pack with
a `source` instead (audit §8 rule 1). `--update` exists to record the *removal*
of tokens; a review must reject an update that grows any number.

What is scanned: `apps/desktop/src-tauri/src` and all production code under
`apps/desktop/src` (`.rs .ts .tsx`; Phase 4 target: zero tokens there).
Skipped: anything under a `tests/`, `fixtures/`, `data/` (generated tables such
as `data/wmi.json`) or `mock/` (per-brand demo data) directory, test files
(`tests.rs`, `*_test.rs`, `*.test.ts`, `*.test.tsx`), any `mock.ts`,
comment-only lines (`//`, `///`, `//!`, `/* … */`, `*`, `{/* … */}`, SQL `--`),
and brace-balanced `#[cfg(test)] mod … { … }` blocks in Rust files.

Tokens (case-insensitive, matched on identifier boundaries so `0x752`, `"752"`
and `c41_session` count but `17520` does not): brand names, the platform key,
adapter names, the vehicle-specific CAN ids, vendor DIDs, plan prefix and part
references listed in TOKENS below. Standard-library only; no dependencies.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(ROOT, "scripts", "brand_token_baseline.json")
SCAN_DIRS = ["apps/desktop/src-tauri/src", "apps/desktop/src"]
EXTENSIONS = (".rs", ".ts", ".tsx")

TOKENS = [
    "citroen",
    "citroën",
    "peugeot",
    "psa",
    "stellantis",
    "c41",
    "vgate",
    "v-link",
    "6A8",
    "6AD",
    "6B5",
    "74A",
    "752",
    "75F",
    "F080",
    "F0FE",
    "citroen-c41",
    "9846124980",
    "9844551780",
    "9817137180",
]


def _pattern(token: str) -> re.Pattern[str]:
    body = re.escape(token)
    if re.fullmatch(r"[0-9A-Fa-f]+", token):
        body = r"(?:0x)?" + body
    return re.compile(r"(?<![0-9A-Za-z_])" + body + r"(?![0-9A-Za-z_])", re.IGNORECASE)


PATTERNS = [(t, _pattern(t)) for t in TOKENS]

_COMMENT_ONLY = re.compile(r"^\s*(//|/\*|\*|\{/\*|--)")
_TEST_ATTR = re.compile(r"^\s*#\[cfg\(test\)\]\s*$")
_MOD_OPEN = re.compile(r"^\s*(pub(\([^)]*\))?\s+)?mod\s+\w+\s*\{")


def is_excluded(rel: str) -> bool:
    parts = rel.replace(os.sep, "/").split("/")
    if "tests" in parts or "fixtures" in parts or "data" in parts or "mock" in parts:
        return True
    name = parts[-1]
    return (
        name == "mock.ts"
        or name == "tests.rs"
        or name.endswith("_test.rs")
        or name.endswith((".test.ts", ".test.tsx"))
    )


def strip_block_comments(text: str) -> str:
    """Blank out /* … */ comments spanning lines, preserving line count."""
    out: list[str] = []
    i = 0
    quote: str | None = None
    while i < len(text):
        if quote:
            out.append(text[i])
            if text[i] == "\\" and i + 1 < len(text):
                i += 1
                out.append(text[i])
            elif text[i] == quote:
                quote = None
            i += 1
            continue
        if text[i] in "'\"`":
            quote = text[i]
            out.append(text[i])
            i += 1
            continue
        if text.startswith("//", i):
            end = text.find("\n", i)
            if end < 0:
                out.append(text[i:])
                break
            out.append(text[i:end + 1])
            i = end + 1
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = len(text) if end < 0 else end + 2
            out.append("\n" * text[i:end].count("\n"))
            i = end
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def strip_line_comments(text: str) -> str:
    out: list[str] = []
    quote: str | None = None
    i = 0
    while i < len(text):
        if quote:
            out.append(text[i])
            if text[i] == "\\" and i + 1 < len(text):
                i += 1
                out.append(text[i])
            elif text[i] == quote:
                quote = None
            i += 1
            continue
        if text[i] in "'\"`":
            quote = text[i]
            out.append(text[i])
            i += 1
            continue
        if text.startswith("//", i):
            end = text.find("\n", i)
            if end < 0:
                break
            out.append("\n")
            i = end + 1
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def code_lines(path: str) -> list[str]:
    """Lines that count: no comment-only lines, no `#[cfg(test)] mod` blocks."""
    text = strip_line_comments(strip_block_comments(open(path, encoding="utf-8").read()))
    lines = text.split("\n")
    kept: list[str] = []
    depth = 0
    pending_test_mod = False
    for line in lines:
        if depth > 0:
            depth += line.count("{") - line.count("}")
            continue
        if path.endswith(".rs"):
            if _TEST_ATTR.match(line):
                pending_test_mod = True
                continue
            if pending_test_mod:
                pending_test_mod = False
                if _MOD_OPEN.match(line):
                    depth = line.count("{") - line.count("}")
                    continue
        if _COMMENT_ONLY.match(line):
            continue
        kept.append(line)
    return kept


def count_file(path: str) -> int:
    total = 0
    for line in code_lines(path):
        for _, pat in PATTERNS:
            total += len(pat.findall(line))
    return total


def scan() -> dict[str, int]:
    counts: dict[str, int] = {}
    for scan_dir in SCAN_DIRS:
        base = os.path.join(ROOT, scan_dir)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(d for d in dirnames if d != "node_modules")
            for name in sorted(filenames):
                if not name.endswith(EXTENSIONS):
                    continue
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
                if is_excluded(rel):
                    continue
                n = count_file(full)
                if n:
                    counts[rel] = n
    return counts


def load_baseline() -> dict[str, int]:
    if not os.path.exists(BASELINE):
        return {}
    with open(BASELINE, encoding="utf-8") as f:
        return json.load(f)


def write_baseline(counts: dict[str, int]) -> None:
    with open(BASELINE, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(counts.items())), f, indent=2)
        f.write("\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--update", action="store_true", help="rewrite the baseline from the current tree")
    ap.add_argument("--verbose", action="store_true", help="print every file's count")
    ap.add_argument("--self-test", action="store_true", help="run comment-stripper checks")
    args = ap.parse_args()

    if args.self_test:
        cases = {
            "line-comment-with-slash-star": ("// /*\nCitroen\n", "// /*\nCitroen\n"),
            "string-with-slash-star": ('const marker = "/* //";\nCitroen\n', 'const marker = "/* //";\nCitroen\n'),
            "real-block": ("before /* Citroen\nstill blocked\n", "before \n\n"),
        }
        for name, (source, expected) in cases.items():
            actual = strip_block_comments(source)
            if name == "string-with-slash-star":
                actual = strip_line_comments(actual)
            if actual != expected or actual.count("\n") != source.count("\n"):
                print(f"FAIL: {name}")
                return 1
            print(f"PASS: {name}")
        return 0

    current = scan()
    baseline = load_baseline()

    if args.update:
        grew = [f for f, n in current.items() if baseline and n > baseline.get(f, 0)]
        write_baseline(current)
        print(f"baseline written: {len(current)} files, {sum(current.values())} tokens")
        if grew:
            print("WARNING: these files grew; the baseline may only shrink:")
            for f in grew:
                print(f"  {f}: {baseline.get(f, 0)} -> {current[f]}")
            return 1
        return 0

    failures: list[str] = []
    improvements: list[str] = []
    for f in sorted(set(current) | set(baseline)):
        before, now = baseline.get(f), current.get(f, 0)
        if before is None:
            failures.append(f"  NEW  {f}: {now} (not in baseline)")
        elif now > before:
            failures.append(f"  GREW {f}: {before} -> {now}")
        elif now < before:
            improvements.append(f"  down {f}: {before} -> {now}")
        elif args.verbose:
            print(f"  same {f}: {now}")

    total_b, total_c = sum(baseline.values()), sum(current.values())
    print(f"brand tokens: {total_c} in {len(current)} files (baseline {total_b} in {len(baseline)})")
    if improvements:
        print("shrunk since the baseline (run --update to record it):")
        print("\n".join(improvements))
    if failures:
        print("FAIL: brand tokens added outside pack data (see the script header):")
        print("\n".join(failures))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
