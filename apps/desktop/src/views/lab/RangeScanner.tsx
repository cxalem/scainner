import { useEffect, useState } from "react";
import { Effect } from "effect";
import { listen } from "@/lib/tauri";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { Button, Card, Input, Mono, Note, ProgressBar } from "@/components/ui";
import { List, Item, Reveal } from "@/motion/components";
import { hex4 } from "@/shared/domain/gauges";
import type { UdsHit } from "@scainner/core";
import { useT } from "@/i18n";
import { useToast } from "@/components/toast";

const SCAN_CHUNK = 256;

type LiveProgress = { current: number; total: number; did: string; hits: number };

export function RangeScanner({
  module,
  connected,
  defaultRange = null,
  onProbeCandidate,
}: {
  module: string;
  connected: boolean;
  defaultRange?: [number, number] | null;
  onProbeCandidate: (hit: UdsHit) => void;
}) {
  const t = useT();
  const toast = useToast();
  const r = t.lab.rangeScanner;
  const [scanFrom, setScanFrom] = useState("");
  const [scanTo, setScanTo] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched || !defaultRange) return;
    setScanFrom(hex4(defaultRange[0]));
    setScanTo(hex4(defaultRange[1]));
  }, [defaultRange, touched]);
  const [hits, setHits] = useState<UdsHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null);

  useEffect(() => {
    const un = listen<LiveProgress>("uds-scan-progress", (e) => setLiveProgress(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const scan = async () => {
    setBusy(true);
    setError(null);
    setHits([]);
    setProgress(null);
    setLiveProgress(null);
    try {
      const from = parseInt(scanFrom, 16);
      const to = parseInt(scanTo, 16);
      const all: UdsHit[] = [];
      for (let start = from; start <= to; start += SCAN_CHUNK) {
        const end = Math.min(start + SCAN_CHUNK - 1, to);
        setProgress(r.scanningChunk(hex4(start), hex4(end), all.length));
        const chunk = await runPromise(Effect.flatMap(DeviceService, (device) => device.udsScan(module, start, end)));
        all.push(...chunk);
        setHits([...all]);
      }
      setProgress(r.scanDone(all.length));
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      if (message.includes("ride_in_progress")) toast.show("warning", t.ride.ride_in_progress);
      const engineStop = message.match(/engine_started:([0-9A-Fa-f]{4}):(\d+)/);
      if (engineStop) {
        setProgress(r.engineStarted(hex4(parseInt(engineStop[1], 16)), Number(engineStop[2])));
        setError(null);
      } else {
        setProgress(message);
        setError(message.includes("cancelled") ? null : message);
      }
    } finally {
      setBusy(false);
      setLiveProgress(null);
    }
  };

  const hexField = (v: string) => v.replace(/[^0-9a-fA-F]/g, "").slice(0, 4);

  return (
    <Card className="gap-[9px] px-4 py-3.5">
      <span className="text-[13px]">{t.lab.drawer.sweepRange}</span>
      <div className="flex items-center gap-2">
        <Input aria-label={r.fromAriaLabel} className="num text-[12.5px]" value={scanFrom} onChange={(e) => { setTouched(true); setScanFrom(hexField(e.target.value)); }} />
        <span className="text-[12px] text-neutral-500">{r.to}</span>
        <Input aria-label={r.toAriaLabel} className="num text-[12.5px]" value={scanTo} onChange={(e) => { setTouched(true); setScanTo(hexField(e.target.value)); }} />
        <Button size="sm" onClick={scan} busy={busy} disabled={!connected}>
          {busy ? (liveProgress ? r.scanningWithCount(liveProgress.hits) : r.scanning) : r.scan}
        </Button>
        {busy && (
          <Button variant="ghost" size="sm" onClick={() => runPromise(Effect.flatMap(DeviceService, (device) => device.udsCancelScan()))}>
            {t.lab.run.stop}
          </Button>
        )}
      </div>
      <Reveal when={liveProgress != null} mode="fade">
        {liveProgress && (
          <div className="flex flex-col gap-1">
            <ProgressBar height={2} value={(liveProgress.current / Math.max(1, liveProgress.total)) * 100} />
            <Mono className="text-[11.5px] text-neutral-500">
              {r.checkingProgress(liveProgress.did, liveProgress.current, liveProgress.total)}
              {liveProgress.current > 0 && liveProgress.hits === 0 ? r.noAnswersYetNote : ""}
            </Mono>
          </div>
        )}
      </Reveal>
      <Mono className="min-h-[15px] text-[12px] text-neutral-400">{!liveProgress && progress ? progress : ""}</Mono>
      {hits.length > 0 && (
        <List className="max-h-72 overflow-y-auto">
          {hits.map((h) => (
            <Item key={h.did} className="num flex items-center gap-2 border-b border-neutral-900 py-1 text-[12px] last:border-0">
              <span className="w-[42px] shrink-0 text-neutral-500">{hex4(h.did)}</span>
              <span className="min-w-0 flex-1 break-all">{h.hex}</span>
              <span className="text-neutral-500">|{h.ascii}|</span>
              <Button variant="ghost" size="sm" className="font-sans" onClick={() => onProbeCandidate(h)}>
                {r.probeAction}
              </Button>
            </Item>
          ))}
        </List>
      )}
      {error && <p className="text-[12px] text-stop">{error}</p>}
      {!connected && !progress && <Note className="text-[11.5px]">{t.lab.run.needsCable}</Note>}
    </Card>
  );
}
