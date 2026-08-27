#!/usr/bin/env python3
"""Read-only drive logger: polls ABS candidate DIDs (6AD/68D) and OBD speed/RPM
(7E0/7E8) round-robin over the V-LINK ELM327, ~1 Hz, appending CSV rows.
Only service 22 / mode 01 requests. Same termios setup as the app's driver."""
import os, sys, termios, time, csv, signal

PORT = "/dev/cu.V-LINK"
OUT = sys.argv[1] if len(sys.argv) > 1 else "drive_log.csv"
DURATION = float(sys.argv[2]) if len(sys.argv) > 2 else 900.0
ABS_DIDS = ["D400", "D401", "D402", "D403", "D406", "D40C", "D464", "D479", "D46D"]

fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY)
t = termios.tcgetattr(fd)
t[0] = 0; t[1] = 0; t[3] = 0
t[2] = termios.CREAD | termios.CLOCAL | termios.CS8
t[4] = termios.B115200; t[5] = termios.B115200
t[6][termios.VMIN] = 0; t[6][termios.VTIME] = 1
termios.tcsetattr(fd, termios.TCSANOW, t)
termios.tcflush(fd, termios.TCIOFLUSH)

def cmd(c, timeout=1.0):
    os.write(fd, (c + "\r").encode())
    buf = b""; end = time.time() + timeout
    while time.time() < end:
        chunk = os.read(fd, 256)
        if chunk:
            buf += chunk
            if b">" in buf: break
    return buf.decode(errors="replace").replace("\r", "\n")

def payload(resp, prefix):
    """Return bytes after prefix (e.g. '62 D4 00' or '41 0D') across possible multi-line frames."""
    hexes = []
    for line in resp.split("\n"):
        line = line.strip()
        if not line or line == ">" or "NO DATA" in line or "SEARCHING" in line: continue
        if ":" in line and len(line.split(":")[0]) <= 2: line = line.split(":", 1)[1]
        parts = line.split()
        if all(len(p) == 2 and all(ch in "0123456789ABCDEF" for ch in p) for p in parts): hexes += parts
    s = " ".join(hexes)
    i = s.find(prefix)
    return None if i < 0 else s[i + len(prefix):].strip()

def route(req, resp):
    for c in ["ATSH " + req, "ATCRA " + resp, "ATFCSH " + req, "ATFCSD 300000", "ATFCSM 1"]:
        cmd(c, 0.5)

stop = False
def on_sig(*_):
    global stop; stop = True
signal.signal(signal.SIGTERM, on_sig); signal.signal(signal.SIGINT, on_sig)

# handshake like the app: ATZ (retry) -> ATE0 -> protocol
banner = ""
for _ in range(3):
    banner = cmd("ATZ", 6.0)
    if "ELM" in banner: break
    time.sleep(1)
cmd("ATE0", 3.0); cmd("ATL0", 1.0); cmd("ATS1", 1.0); cmd("ATH0", 1.0)
cmd("ATSP6", 2.0); cmd("ATCAF1", 1.0); cmd("ATST 20", 1.0)

with open(OUT, "a", newline="") as f:
    w = csv.writer(f)
    w.writerow(["ts", "key", "raw"]); f.flush()
    w.writerow([time.strftime("%H:%M:%S"), "banner", banner.strip().replace("\n", " ")]); f.flush()
    t0 = time.time(); cycles = 0
    while not stop and time.time() - t0 < DURATION:
        route("6AD", "68D")
        for did in ABS_DIDS:
            r = cmd("22" + did, 0.8)
            w.writerow([time.strftime("%H:%M:%S"), did, payload(r, "62 " + did[:2] + " " + did[2:]) or ("ERR:" + r.strip().replace("\n", " ")[:40])])
        route("7E0", "7E8")
        for pid, key in [("0D", "speed"), ("0C", "rpm"), ("42", "volt")]:
            r = cmd("01" + pid, 0.8)
            w.writerow([time.strftime("%H:%M:%S"), key, payload(r, "41 " + pid) or ("ERR:" + r.strip().replace("\n", " ")[:40])])
        f.flush(); cycles += 1
cmd("ATSP0", 1.0); cmd("ATSH 7DF", 1.0); cmd("ATAR", 1.0); cmd("ATFCSM 0", 1.0)
os.close(fd)
print("done", cycles, "cycles")
