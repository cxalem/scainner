# Hunt v2: ABS + Engine (the modules that answer on the C4 III).
import sys, os
sys.path.insert(0, "/private/tmp/claude-501/-Users-cxalem-projects-personal-hub/da375494-e89b-46bf-8c45-8f5095371f4c/scratchpad")
from uds_common import *
import uds_common as U

if not connect(): print("FAILED to wake dongle"); raise SystemExit(1)

PLAN = [
    ("Engine", "6A8", "688", [(0xF080, 0xF1FF), (0xD000, 0xDFFF), (0x2000, 0x22FF)]),
    ("ABS",    "6AD", "68D", [(0xF080, 0xF1FF), (0xD000, 0xDFFF), (0x2000, 0x22FF)]),
]

for name, req, resp, ranges in PLAN:
    uds_setup(req, resp)
    s = cmd("1003", 1.5)
    print(f"\n=== {name} ({req}->{resp}) session: {'OK' if '50' in s else s.strip()[:30]!r} ===", flush=True)
    for lo, hi in ranges:
        print(f"--- range {lo:04X}-{hi:04X} ---", flush=True)
        n = 0
        for i, did in enumerate(range(lo, hi + 1)):
            if i % 40 == 39:
                cmd("3E00", 0.6)
            d = read_did(did, wait=0.7)
            if d is not None:
                a = "".join(chr(x) if 32 <= x < 127 else "." for x in d)
                print(f"{did:04X}: {' '.join(f'{x:02X}' for x in d)} |{a}|", flush=True)
                n += 1
        print(f"--- {n} hits in {lo:04X}-{hi:04X} ---", flush=True)
os.close(U.FD)
print("HUNT COMPLETE", flush=True)
