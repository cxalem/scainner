import os, time, termios, subprocess

BT = "10-21-3e-4f-e8-c1"; PORT = "/dev/cu.V-LINK"; BU = "/opt/homebrew/bin/blueutil"

def _cycle():
    subprocess.run([BU,"--disconnect",BT],capture_output=True); time.sleep(1)
    subprocess.run([BU,"--connect",BT],capture_output=True)
    for _ in range(10):
        if os.path.exists(PORT): return True
        time.sleep(0.5)
    return os.path.exists(PORT)

def _repair():
    subprocess.run([BU,"--unpair",BT],capture_output=True); time.sleep(2)
    subprocess.run([BU,"--pair",BT,"1234"],capture_output=True); time.sleep(1)
    subprocess.run([BU,"--connect",BT],capture_output=True)
    for _ in range(15):
        if os.path.exists(PORT): return True
        time.sleep(1)
    return _cycle()

def _open():
    fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY)
    a = termios.tcgetattr(fd)
    cc = list(a[6]); cc[termios.VMIN]=0; cc[termios.VTIME]=1
    termios.tcsetattr(fd, termios.TCSANOW,
        [0,0,termios.CREAD|termios.CLOCAL|termios.CS8,0,termios.B115200,termios.B115200,cc])
    termios.tcflush(fd, termios.TCIOFLUSH)
    return fd

FD = None
def cmd(c, wait=2.0):
    os.write(FD,(c+"\r").encode())
    buf=b""; end=time.time()+wait
    while time.time()<end:
        ch=os.read(FD,256)
        if ch:
            buf+=ch
            if b">" in buf: break
        else: time.sleep(0.02)
    return buf.decode(errors="replace")

def connect():
    global FD
    for stage in ("cycle","repair"):
        if not (_cycle() if stage=="cycle" else _repair()): continue
        time.sleep(1)
        FD=_open()
        ok=False
        for _ in range(2):
            if "ELM" in cmd("ATZ",6): ok=True; break
        if ok:
            print(f"# connected via {stage}", flush=True)
            return True
        os.close(FD); FD=None
    return False

def hexbytes(raw):
    toks=[]
    for line in raw.replace("\r","\n").split("\n"):
        line=line.strip().rstrip(">").strip()
        if not line or "SEARCHING" in line: continue
        if ":" in line:
            i,r=line.split(":",1)
            if all(c in "0123456789abcdefABCDEF" for c in i.strip()): line=r
        for t in line.split():
            if len(t)==2:
                try: toks.append(int(t,16))
                except ValueError: pass
    return toks

def uds_setup(req, resp):
    cmd("ATSP6"); cmd("ATCAF1"); cmd("ATH0")
    cmd("ATSH "+req); cmd("ATCRA "+resp)
    cmd("ATFCSH "+req); cmd("ATFCSD 300000"); cmd("ATFCSM 1")

def read_did(did, wait=1.2):
    r = cmd(f"22{did:04X}", wait)
    b = hexbytes(r)
    # positive: 62 DID_H DID_L data...
    for i in range(len(b)-2):
        if b[i]==0x62 and b[i+1]==(did>>8) and b[i+2]==(did&0xFF):
            return b[i+3:]
    return None
