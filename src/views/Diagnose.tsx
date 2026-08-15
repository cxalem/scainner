import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, CheckCircle2, Info, RefreshCw, ShieldCheck, Snowflake } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { GAUGES, MONITOR_LABELS, type DtcResult, type DtcScanRow } from "@/lib/meta";

function CodeList({ label, codes }: { label: string; codes: string[] }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 text-muted-foreground">{label}</span>
      {codes.length === 0 ? (
        <span className="text-muted-foreground">none</span>
      ) : (
        codes.map((c) => (
          <Badge key={c} variant="error" className="font-mono">
            {c}
          </Badge>
        ))
      )}
    </div>
  );
}

function FreezeFrame({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k]) => k !== "trigger_dtc");
  return (
    <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
      <p className="mb-2 flex items-center gap-1.5 font-medium">
        <Snowflake className="h-4 w-4" aria-hidden="true" /> Freeze frame
        {"trigger_dtc" in data && (
          <span className="font-mono text-xs text-muted-foreground">caused by {String(data.trigger_dtc)}</span>
        )}
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {entries.map(([k, v]) => {
          const g = GAUGES.find((x) => x.key === k);
          return (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{g?.label ?? k}</span>
              <span className="font-mono">
                {typeof v === "number" ? (g?.fmt ? g.fmt(v) : v) : String(v)} {g?.unit ?? ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Diagnose({ connected }: { connected: boolean }) {
  const [scan, setScan] = useState<DtcResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<DtcScanRow[]>([]);
  const [readiness, setReadiness] = useState<Record<string, boolean> | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearedBanner, setClearedBanner] = useState<{ before: number; after: number } | null>(null);

  const loadHistory = () => invoke<DtcScanRow[]>("dtc_history", { limit: 20 }).then(setHistory).catch(() => {});
  useEffect(() => {
    loadHistory();
  }, []);

  const doScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const r = await invoke<DtcResult>("scan_dtcs");
      setScan(r);
      try {
        setReadiness(await invoke<Record<string, boolean>>("readiness"));
      } catch {
        // readiness is best-effort
      }
      loadHistory();
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  };

  const doClear = async () => {
    setConfirmClear(false);
    setError(null);
    const before = scan ? scan.stored.length + scan.pending.length : 0;
    try {
      await invoke("clear_dtcs");
      // Verify: re-scan and show the outcome explicitly instead of leaving
      // the user guessing whether anything happened.
      const r = await invoke<DtcResult>("scan_dtcs");
      setScan(r);
      setClearedBanner({ before, after: r.stored.length + r.pending.length });
      loadHistory();
    } catch (e) {
      setError(String(e));
    }
  };

  const totalCodes = scan ? scan.stored.length + scan.pending.length + scan.permanent.length : 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Diagnose</h1>

      <div className="flex items-center gap-2">
        <Button onClick={doScan} disabled={!connected || scanning}>
          <RefreshCw className={"h-4 w-4" + (scanning ? " animate-spin" : "")} aria-hidden="true" />
          {scanning ? "Scanning…" : "Scan for codes"}
        </Button>
        {scan && totalCodes > 0 && !confirmClear && (
          <Button variant="outline" onClick={() => setConfirmClear(true)}>
            Clear codes…
          </Button>
        )}
      </div>

      {confirmClear && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <span>
            This erases stored codes and resets readiness monitors. The scan above is already saved to history.
            Really clear?
          </span>
          <Button variant="destructive" onClick={doClear}>
            Yes, clear
          </Button>
          <Button variant="ghost" onClick={() => setConfirmClear(false)}>
            Cancel
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {clearedBanner && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/50 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            {clearedBanner.after === 0 ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                Cleared and verified — {clearedBanner.before || "no"} code
                {clearedBanner.before === 1 ? "" : "s"} before, none remaining.
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
                Cleared, but {clearedBanner.after} code{clearedBanner.after === 1 ? "" : "s"} came straight back —
                active fault{clearedBanner.after === 1 ? "" : "s"}, not leftovers. Worth investigating.
              </>
            )}
          </p>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            No ignition cycle needed for the check-engine light — it goes off with the clear. Two things reset with
            it: readiness monitors re-run over your next few drives (relevant before an ITV), and permanent codes (if
            any) erase themselves only after the car self-verifies the fault is gone.
          </p>
        </div>
      )}

      {scan && (
        <Card>
          <CardHeader>
            <CardTitle>Latest scan</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              {scan.mil_on ? (
                <Badge variant="error">CHECK ENGINE ON · {scan.dtc_count} codes</Badge>
              ) : (
                <Badge variant="ok">
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> MIL off
                </Badge>
              )}
              {scan.voltage != null && <Badge variant="muted">{scan.voltage.toFixed(1)} V</Badge>}
            </div>
            <CodeList label="Stored" codes={scan.stored} />
            <CodeList label="Pending" codes={scan.pending} />
            <CodeList label="Permanent" codes={scan.permanent} />
            {scan.freeze && <FreezeFrame data={scan.freeze as Record<string, unknown>} />}
          </CardContent>
        </Card>
      )}

      {readiness && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Pre-ITV readiness
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(readiness).map(([k, ready]) => (
                <Badge key={k} variant={ready ? "ok" : "warn"}>
                  {MONITOR_LABELS[k] ?? k}: {ready ? "ready" : "not ready"}
                </Badge>
              ))}
            </div>
            {Object.values(readiness).every(Boolean) ? (
              <p className="mt-2 text-sm text-muted-foreground">
                All monitors complete — emissions-wise you would pass ITV today.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Some monitors incomplete (normal after clearing codes or a battery disconnect — they re-run over a few
                drives).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Scan history</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scans recorded yet — run one while connected.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {history.map((h) => {
                const n = h.stored.length + h.pending.length + h.permanent.length;
                return (
                  <li key={h.id} className="flex items-center justify-between border-b border-border py-1.5 last:border-0">
                    <span className="font-mono text-xs text-muted-foreground">{h.ts} UTC</span>
                    <span className="flex items-center gap-2">
                      {n === 0 ? (
                        <Badge variant="ok">clean</Badge>
                      ) : (
                        <Badge variant="error">{[...h.stored, ...h.pending, ...h.permanent].join(", ")}</Badge>
                      )}
                      {h.voltage != null && (
                        <span className="font-mono text-xs text-muted-foreground">{h.voltage.toFixed(1)}V</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
