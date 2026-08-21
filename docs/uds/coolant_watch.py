# Live coolant watch for the parked-overheating question ("Yuli Peugeot").
# READ-ONLY: samples mode-01 coolant (0105) + rpm (010C) + battery (ATRV)
# every ~5s and prints a timestamped line. The diagnostic signature:
#   healthy: temp climbs at idle -> radiator fan engages ~97-105C -> temp
#            drops several degrees -> cycles.
#   broken fan (the "overheats when parked" cause): temp keeps climbing
#            past ~105C with no drop. STOP THE ENGINE if it passes 110C.
# Run with the ENGINE IDLING and the desktop app closed.
import time
from uds_common import connect, cmd, hexbytes

DURATION_S = 15 * 60
SAMPLE_S = 5

def read_pid(pid_hex, resp_pid, wait=2.0):
    b = hexbytes(cmd(pid_hex, wait))
    for i in range(len(b) - 1):
        if b[i] == 0x41 and b[i + 1] == resp_pid:
            return b[i + 2 :]
    return None

def main():
    if not connect():
        print("!! could not reach the dongle", flush=True)
        return
    for c in ("ATE0", "ATL0", "ATH0", "ATSP5"):
        cmd(c)
    # init the bus
    if read_pid("0100", 0x00, 15.0) is None:
        cmd("ATSP0")
        if read_pid("0100", 0x00, 15.0) is None:
            print("!! bus not answering — ignition/engine on?", flush=True)
            return
    print("watching coolant — engine should be IDLING", flush=True)
    peak = -999.0
    fan_seen = False
    t0 = time.time()
    while time.time() - t0 < DURATION_S:
        d = read_pid("0105", 0x05)
        temp = (d[0] - 40) if d else None
        r = read_pid("010C", 0x0C)
        rpm = ((r[0] * 256 + r[1]) / 4) if r and len(r) >= 2 else None
        vraw = cmd("ATRV", 1.0)
        volts = vraw.strip().rstrip(">").strip().replace("V", "")
        el = int(time.time() - t0)
        if temp is not None:
            marker = ""
            if temp > peak:
                peak = temp
            elif peak - temp >= 3 and peak >= 90 and not fan_seen:
                fan_seen = True
                marker = "  <<< temp dropping from peak — fan likely ENGAGED"
            if temp >= 110:
                marker = "  !!! OVER 110C — STOP THE ENGINE"
            elif temp >= 105:
                marker = marker or "  !! over 105C — fan should be running by now"
            print(f"t={el:4d}s coolant={temp:3.0f}C peak={peak:3.0f}C rpm={rpm or 0:4.0f} vbat={volts}{marker}", flush=True)
        else:
            print(f"t={el:4d}s (no coolant answer)", flush=True)
        time.sleep(SAMPLE_S)
    print(f"done — peak {peak:.0f}C, fan drop seen: {fan_seen}", flush=True)

if __name__ == "__main__":
    main()
