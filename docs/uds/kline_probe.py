# K-line/KWP2000 probe for the old Peugeot ("Yuli Peugeot") — READ-ONLY.
#
# Context: docs/workflows/kline-peugeot/research.md. The car speaks ISO
# 14230-4 KWP (fast init, adapter protocol 5) and supports only a small
# mode-01 subset with no mode 09. This probe asks the manufacturer side of
# KWP politely for more: ECU identification (service 1A — may even contain
# a VIN), local data tables (service 21 — the K-line analog of CAN DID
# scanning), and manufacturer DTCs (service 18).
#
# Deliberately NOT sent: 04/14 (clear), 2E/3B (write), 31 (routines),
# 27 (security access). Probing must not change the car.
#
# Run with ignition ON and the desktop app CLOSED (it owns the port).
import sys, time
from uds_common import connect, cmd, hexbytes

def has_positive(raw, svc):
    """True if the response bytes contain the positive-reply id (svc+0x40)."""
    return (svc + 0x40) in hexbytes(raw)

def classify(raw, svc):
    """(kind, payload) where kind is 'pos', 'nrc:<code>', or 'silent'."""
    b = hexbytes(raw)
    for i, v in enumerate(b):
        if v == svc + 0x40:
            return "pos", b[i:]
        if v == 0x7F and i + 2 < len(b) and b[i + 1] == svc:
            return f"nrc:{b[i+2]:02X}", b[i : i + 3]
    return "silent", b

def show(tag, kind, payload):
    hexs = " ".join(f"{v:02X}" for v in payload)
    asc = "".join(chr(v) if 32 <= v < 127 else "." for v in payload)
    print(f"{tag:10s} {kind:8s} {hexs}   |{asc}|", flush=True)

PID_NAMES = {
    0x01: "MIL/DTC status", 0x03: "fuel system status", 0x04: "engine load",
    0x05: "coolant temp", 0x06: "STFT B1", 0x07: "LTFT B1", 0x0B: "intake MAP",
    0x0C: "rpm", 0x0D: "speed", 0x0E: "timing advance", 0x0F: "intake temp",
    0x10: "MAF", 0x11: "throttle", 0x13: "O2 sensors present",
    0x14: "O2 B1S1", 0x15: "O2 B1S2", 0x1C: "OBD standard", 0x20: "PIDs 21-40",
}

def main():
    if not connect():
        print("!! could not reach the dongle (bluetooth/port)", flush=True)
        sys.exit(1)
    for c in ("ATE0", "ATL0", "ATH1", "ATSP5"):
        cmd(c)

    print("== phase 1: bus check + supported-PID bitmap ==", flush=True)
    raw = cmd("0100", 12.0)  # first command performs the fast init (SEARCHING...)
    b = hexbytes(raw)
    if 0x41 not in b:
        print(f"!! bus did not answer 0100 — ignition on? raw: {raw.strip()!r}", flush=True)
        sys.exit(2)
    i = b.index(0x41)
    bits = b[i + 2 : i + 6]
    supported = []
    if len(bits) == 4:
        mask = (bits[0] << 24) | (bits[1] << 16) | (bits[2] << 8) | bits[3]
        supported = [pid for pid in range(1, 0x21) if mask & (1 << (0x20 - pid))]
    print("supported mode-01 PIDs:", ", ".join(
        f"{p:02X} ({PID_NAMES.get(p, '?')})" for p in supported), flush=True)
    if 0x20 in supported:
        k, p = classify(cmd("0120", 4.0), 0x01)
        show("0120", k, p)

    print("== phase 2: mode 09 (expected absent) ==", flush=True)
    k, p = classify(cmd("0900", 4.0), 0x09)
    show("0900", k, p)

    print("== phase 3: KWP 1A readEcuIdentification, blocks 80-9F ==", flush=True)
    for sub in range(0x80, 0xA0):
        k, p = classify(cmd(f"1A{sub:02X}", 2.5), 0x1A)
        if k != "silent":
            show(f"1A {sub:02X}", k, p)

    print("== phase 4: KWP 21 readDataByLocalIdentifier, 00-FF ==", flush=True)
    hits = 0
    for lid in range(0x00, 0x100):
        k, p = classify(cmd(f"21{lid:02X}", 1.2), 0x21)
        if k.startswith("pos"):
            hits += 1
            show(f"21 {lid:02X}", k, p)
        elif k.startswith("nrc") and k not in ("nrc:12", "nrc:11"):
            # unusual NRC (not plain not-supported) is information too
            show(f"21 {lid:02X}", k, p)
    print(f"({hits} local identifiers answered)", flush=True)

    print("== phase 5: KWP 18 readDTCsByStatus ==", flush=True)
    k, p = classify(cmd("1800FFFF", 4.0), 0x18)
    show("18 00FFFF", k, p)
    if k == "silent":
        k, p = classify(cmd("180000", 4.0), 0x18)  # alternate arg form
        show("18 0000", k, p)

    print("== done ==", flush=True)

if __name__ == "__main__":
    main()
