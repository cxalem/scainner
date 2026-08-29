import { useEffect, useState } from "react";
import { Effect } from "effect";
import { listen } from "@/lib/tauri";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { hex4 } from "@/shared/domain/gauges";
import type { UdsHit } from "@scainner/core";
import { useT } from "@/i18n";

const inputCls =
  "h-9 rounded-md border border-border bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

// Must match the backend's per-call cap in uds::scan_range (currently 256).
const SCAN_CHUNK = 256;

type LiveProgress = { current: number; total: number; did: string; hits: number };

/// Scans a range of UDS DIDs on the selected module, chunked to stay under
/// the backend's per-call time cap, with a live progress bar (a silent
/// module gives zero responses for a while — the bar is what tells you
/// that's still "working", not "stuck").
export function RangeScanner({
  module,
  connected,
  defaultRange = null,
  onProbeCandidate,
}: {
  module: string;
  connected: boolean;
  /** The vehicle's parked-plan sweep band for this module; the fields
   *  start empty until the plan says where this brand keeps its data. */
  defaultRange?: [number, number] | null;
  onProbeCandidate: (hit: UdsHit) => void;
}) {
  const t = useT();
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
        setProgress(t.lab.rangeScanner.scanningChunk(hex4(start), hex4(end), all.length));
        const chunk = await runPromise(Effect.flatMap(DeviceService, (device) => device.udsScan(module, start, end)));
        all.push(...chunk);
        setHits([...all]);
      }
      setProgress(t.lab.rangeScanner.scanDone(all.length));
    } catch (e) {
      // A cancel surfaces here too (backend returns it as an error carrying
      // the partial count) — hits already pushed from completed chunks stay
      // on screen either way.
      const message = String(e instanceof Error ? e.message : e);
      const engineStop = message.match(/engine_started:([0-9A-Fa-f]{4}):(\d+)/);
      if (engineStop) {
        setProgress(t.lab.rangeScanner.engineStarted(hex4(parseInt(engineStop[1], 16)), Number(engineStop[2])));
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.lab.rangeScanner.cardTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label={t.lab.rangeScanner.fromAriaLabel}
            className={inputCls + " w-24"}
            value={scanFrom}
            onChange={(e) => { setTouched(true); setScanFrom(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4)); }}
          />
          <span className="text-sm text-muted-foreground">{t.lab.rangeScanner.to}</span>
          <input
            aria-label={t.lab.rangeScanner.toAriaLabel}
            className={inputCls + " w-24"}
            value={scanTo}
            onChange={(e) => { setTouched(true); setScanTo(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4)); }}
          />
          <Button onClick={scan} disabled={!connected || busy}>
            {busy
              ? liveProgress
                ? t.lab.rangeScanner.scanningWithCount(liveProgress.hits)
                : t.lab.rangeScanner.scanning
              : t.lab.rangeScanner.scan}
          </Button>
          {busy && (
            <Button
              variant="outline"
              onClick={() => runPromise(Effect.flatMap(DeviceService, (device) => device.udsCancelScan()))}
            >
              {t.common.cancel}
            </Button>
          )}
          {!liveProgress && progress && <span className="text-xs text-muted-foreground">{progress}</span>}
        </div>
        {liveProgress && (
          <div className="flex flex-col gap-1">
            <div
              role="progressbar"
              aria-valuenow={liveProgress.current}
              aria-valuemax={liveProgress.total}
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 motion-reduce:transition-none"
                style={{ width: `${Math.min(100, (liveProgress.current / Math.max(1, liveProgress.total)) * 100)}%` }}
              />
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {t.lab.rangeScanner.checkingProgress(liveProgress.did, liveProgress.current, liveProgress.total)}
              {liveProgress.current > 0 && liveProgress.hits === 0 ? t.lab.rangeScanner.noAnswersYetNote : ""}
            </span>
          </div>
        )}
        {hits.length > 0 && (
          <div className="max-h-72 overflow-y-auto rounded border border-border">
            <table className="w-full text-xs">
              <tbody>
                {hits.map((h) => (
                  <tr key={h.did} className="border-b border-border/50 font-mono last:border-0">
                    <td className="px-2 py-1 text-muted-foreground">{hex4(h.did)}</td>
                    <td className="break-all px-2 py-1">{h.hex}</td>
                    <td className="px-2 py-1 text-muted-foreground">|{h.ascii}|</td>
                    <td className="px-2 py-1">
                      <button
                        className="rounded text-primary hover:underline transition-transform active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onClick={() => onProbeCandidate(h)}
                      >
                        {t.lab.rangeScanner.probeAction}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
