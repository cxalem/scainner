import { useEffect, useState } from "react";
import { invoke, listen } from "@/lib/tauri";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { hex4, type UdsHit } from "@/lib/meta";

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
  onProbeCandidate,
}: {
  module: string;
  connected: boolean;
  onProbeCandidate: (hit: UdsHit) => void;
}) {
  const [scanFrom, setScanFrom] = useState("D000");
  const [scanTo, setScanTo] = useState("D3FF");
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
        setProgress(`scanning ${hex4(start)}–${hex4(end)}… (${all.length} hits so far)`);
        const chunk = await invoke<UdsHit[]>("uds_scan", { module, from: start, to: end });
        all.push(...chunk);
        setHits([...all]);
      }
      setProgress(
        `done — ${all.length} DIDs answered. Heads-up: scans can leave temporary "lost communication" warnings on the dashboard; an ignition cycle clears them (see Module faults below).`
      );
    } catch (e) {
      // A cancel surfaces here too (backend returns it as an error carrying
      // the partial count) — hits already pushed from completed chunks stay
      // on screen either way.
      setProgress(String(e));
      setError(String(e).startsWith("cancelled") ? null : String(e));
    } finally {
      setBusy(false);
      setLiveProgress(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scan a DID range</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="From DID (hex)"
            className={inputCls + " w-24"}
            value={scanFrom}
            onChange={(e) => setScanFrom(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4))}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <input
            aria-label="To DID (hex)"
            className={inputCls + " w-24"}
            value={scanTo}
            onChange={(e) => setScanTo(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4))}
          />
          <Button onClick={scan} disabled={!connected || busy}>
            {busy ? (liveProgress ? `Scanning… (${liveProgress.hits} found)` : "Scanning…") : "Scan"}
          </Button>
          {busy && (
            <Button variant="outline" onClick={() => invoke("uds_cancel_scan")}>
              Cancel
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
              checking {liveProgress.did}… {liveProgress.current}/{liveProgress.total} in this chunk
              {liveProgress.current > 0 && liveProgress.hits === 0
                ? " — no answers yet; some modules stay silent for a whole range, that's normal"
                : ""}
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
                        → probe
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
