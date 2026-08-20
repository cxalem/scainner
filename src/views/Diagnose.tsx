import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Info, RefreshCw, ShieldCheck, Snowflake, Sparkles, X } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton, useCyclingLabel, useTransientLabel } from "@/components/ui";
import { GAUGES, MONITOR_LABELS, type DtcResult, type DtcScanRow } from "@/lib/meta";
import {
  AI_PHASES,
  generateCodeReport,
  generateDiagnosisReport,
  getApiKey,
  getCodeReports,
  getLastReport,
  setApiKey,
  type SavedReport,
} from "@/lib/ai";
import { decodeDtc, dtcInfo } from "@/lib/dtc";
import { useClearDtcs, useDtcHistory, useScanDtcs } from "@/lib/queries";

// Every code badge in this view is a button into the per-code detail modal.
function CodeBadge({ code, onSelect }: { code: string; onSelect: (c: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(code)}
      className="rounded-full transition-transform hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2"
      aria-label={`Details for ${code}`}
    >
      <Badge variant="error" className="cursor-pointer font-mono underline-offset-2 hover:underline">
        {code}
      </Badge>
    </button>
  );
}

function CodeList({ label, codes, onSelect }: { label: string; codes: string[]; onSelect: (c: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 text-muted-foreground">{label}</span>
      {codes.length === 0 ? (
        <span className="text-muted-foreground">none</span>
      ) : (
        codes.map((c) => <CodeBadge key={c} code={c} onSelect={onSelect} />)
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

// Per-code detail: everything the app knows about one DTC, from high level
// down — plain-language meaning + severity (curated library), the code's
// structural anatomy (works for ANY code), its full occurrence timeline
// across scan history, the freeze frame if this code triggered one, ranked
// common causes/symptoms, and a focused AI deep-dive for exactly this
// fault on exactly this car.
function DtcDetailModal({
  code,
  history,
  scan,
  onClose,
}: {
  code: string;
  history: DtcScanRow[];
  scan: DtcResult | null;
  onClose: () => void;
}) {
  const info = dtcInfo(code);
  const structure = decodeDtc(code);
  const [report, setReport] = useState<SavedReport | null>(() => getCodeReports()[code] ?? null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasKey = !!getApiKey();
  // Plain fetch outside `invoke`, no midpoint signal possible from the
  // Anthropic API — cycled phrases instead of a static label so a 10-60s
  // wait doesn't read as frozen (interaction-audit.md rule 3).
  const generatingLabel = useCyclingLabel(AI_PHASES, generating, 3500);

  const occurrences = history
    .filter((h) => h.stored.includes(code) || h.pending.includes(code) || h.permanent.includes(code))
    .map((h) => ({
      ts: h.ts,
      role: h.stored.includes(code) ? "stored" : h.pending.includes(code) ? "pending" : "permanent",
      voltage: h.voltage,
    }));

  const freeze =
    scan?.freeze && String((scan.freeze as Record<string, unknown>).trigger_dtc) === code
      ? (scan.freeze as Record<string, unknown>)
      : (history.find((h) => h.freeze && String((h.freeze as Record<string, unknown>).trigger_dtc) === code)
          ?.freeze as Record<string, unknown> | undefined) ?? null;

  const doGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const summary =
        occurrences.map((o) => `- ${o.ts} UTC — seen as ${o.role}${o.voltage != null ? ` (battery ${o.voltage.toFixed(1)} V)` : ""}`).join("\n") +
        (freeze ? `\nFreeze frame at the moment it tripped: ${JSON.stringify(freeze)}` : "");
      setReport(await generateCodeReport(code, summary || "(no recorded occurrences — code seen in a live scan only)"));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  };

  const sevVariant = info?.severity === "high" ? "error" : info?.severity === "medium" ? "warn" : "muted";
  const sevLabel = info ? { low: "low urgency", medium: "attention", high: "serious" }[info.severity] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/30 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${code}`}
    >
      <Card className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{code}</span>
              {sevLabel && <Badge variant={sevVariant}>{sevLabel}</Badge>}
            </CardTitle>
            <p className="mt-1 text-sm font-medium">{info?.title ?? "Not in the built-in library — structural decode and AI analysis below"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 hover:bg-muted transition-transform active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {info && <p>{info.meaning}</p>}

          {structure && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="mb-1 font-medium">Code anatomy</p>
              <ul className="flex flex-col gap-0.5 text-muted-foreground">
                <li>System: {structure.system}</li>
                {structure.subsystem && <li>Area: {structure.subsystem}</li>}
                <li>{structure.origin}</li>
              </ul>
            </div>
          )}

          <div>
            <p className="mb-1 font-medium">When it happened</p>
            {occurrences.length === 0 ? (
              <p className="text-muted-foreground">Not in any recorded scan (seen live only).</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {occurrences.map((o, i) => (
                  <li key={i} className="flex items-center justify-between border-b border-border py-1 last:border-0">
                    <span className="font-mono text-xs text-muted-foreground">{o.ts} UTC</span>
                    <Badge variant={o.role === "pending" ? "warn" : "error"}>{o.role}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {freeze && <FreezeFrame data={freeze} />}

          {info && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 font-medium">Common causes (most likely first)</p>
                <ol className="list-decimal pl-5 text-muted-foreground">
                  {info.causes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="mb-1 font-medium">Typical symptoms</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {info.symptoms.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <Button onClick={doGenerate} disabled={generating || !hasKey}>
                <Sparkles className={"h-4 w-4" + (generating ? " animate-pulse" : "")} aria-hidden="true" />
                {generating ? generatingLabel : report ? "Regenerate AI deep-dive" : "AI deep-dive for this code"}
              </Button>
            </div>
            {!hasKey && (
              <p className="text-xs text-muted-foreground">
                Set your Anthropic API key in the AI diagnosis card below to enable per-code analysis.
              </p>
            )}
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">{error}</div>
            )}
            {report && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="mb-2 font-mono text-xs text-muted-foreground">generated {report.ts}</p>
                <div className="whitespace-pre-wrap leading-relaxed">{report.md}</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// AI diagnosis card: sends the backend's `ai_context` briefing (car
// identity, DTC scan history with freeze frames, sensor stats) to the
// Anthropic API with the user's own key and renders the returned report.
// The key lives in localStorage only — see src/lib/ai.ts for why not the DB.
function AiReportCard({ hasAnyData }: { hasAnyData: boolean }) {
  const [hasKey, setHasKey] = useState(() => !!getApiKey());
  const [keyDraft, setKeyDraft] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [report, setReport] = useState<SavedReport | null>(() => getLastReport());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same transient success idiom as Overview's fuel save and Vehicle's
  // exports — plan.md rule 10 extracted it into ui.tsx once, so this card
  // uses the shared helper too instead of its own useState+setTimeout.
  const [copyLabel, flashCopy] = useTransientLabel(1500);
  const generatingLabel = useCyclingLabel(AI_PHASES, generating, 3500);

  const saveKey = () => {
    setApiKey(keyDraft);
    setHasKey(!!keyDraft.trim());
    setKeyDraft("");
    setEditingKey(false);
  };

  const doGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      setReport(await generateDiagnosisReport());
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  };

  const doCopy = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(report.md);
    flashCopy("copied");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> AI diagnosis
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!hasKey || editingKey ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Analyzes the scan history, freeze frames, and sensor trends above with Claude and writes a diagnosis
              report. Needs your own Anthropic API key — it is stored only on this machine and used only when you
              generate a report.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="sk-ant-…"
                className="w-64 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm"
                aria-label="Anthropic API key"
              />
              <Button onClick={saveKey} disabled={!keyDraft.trim() && !editingKey}>
                Save key
              </Button>
              {editingKey && (
                <Button variant="ghost" onClick={() => { setEditingKey(false); setKeyDraft(""); }}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={doGenerate} disabled={generating || !hasAnyData}>
                <Sparkles className={"h-4 w-4" + (generating ? " animate-pulse" : "")} aria-hidden="true" />
                {generating ? generatingLabel : report ? "Regenerate report" : "Generate report"}
              </Button>
              {report && (
                <Button variant="outline" onClick={doCopy}>
                  <Copy className="h-4 w-4" aria-hidden="true" /> {copyLabel === "copied" ? "Copied" : "Copy"}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setEditingKey(true)}>
                Change key…
              </Button>
            </div>
            {!hasAnyData && (
              <p className="text-sm text-muted-foreground">Run at least one scan first — the report analyzes real recorded data.</p>
            )}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Generating sends this car's diagnostic briefing (identity, codes, sensor stats) to the Anthropic API.
            </p>
          </>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {report && !editingKey && (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="mb-2 font-mono text-xs text-muted-foreground">generated {report.ts}</p>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{report.md}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Diagnose({ connected }: { connected: boolean }) {
  const [scan, setScan] = useState<DtcResult | null>(null);
  const [readiness, setReadiness] = useState<Record<string, boolean> | null>(null);
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearedBanner, setClearedBanner] = useState<{ before: number; after: number } | null>(null);

  const historyQuery = useDtcHistory();
  const history = historyQuery.data ?? [];
  const scanMutation = useScanDtcs();
  const clearMutation = useClearDtcs();
  const error = scanMutation.error ?? clearMutation.error;

  const doScan = () => {
    scanMutation.mutate(undefined, {
      onSuccess: ({ scan: r, readiness: rd }) => {
        setScan(r);
        setReadiness(rd);
      },
    });
  };

  const doClear = () => {
    const before = scan ? scan.stored.length + scan.pending.length : 0;
    clearMutation.mutate(undefined, {
      onSuccess: (r) => {
        setScan(r);
        setClearedBanner({ before, after: r.stored.length + r.pending.length });
      },
      // Modal closes only once the mutation settles (success or error), not
      // on click — the previous behavior closed it immediately, leaving a
      // destructive, chained slow-hardware action with no visible owner
      // while it ran (interaction-audit.md worst offender #1).
      onSettled: () => setConfirmClear(false),
    });
  };

  const totalCodes = scan ? scan.stored.length + scan.pending.length + scan.permanent.length : 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Diagnose</h1>

      <div className="flex items-center gap-2">
        <Button onClick={doScan} disabled={!connected || scanMutation.isPending}>
          <RefreshCw className={"h-4 w-4" + (scanMutation.isPending ? " animate-spin" : "")} aria-hidden="true" />
          {scanMutation.isPending ? "Scanning…" : "Scan for codes"}
        </Button>
        {scan && totalCodes > 0 && !confirmClear && (
          <Button variant="outline" onClick={() => setConfirmClear(true)}>
            Clear codes…
          </Button>
        )}
      </div>

      {confirmClear && (
        // Modal, not an inline banner: the banner pushed the whole page down
        // (layout shift, forbidden by the design principles). Centered card
        // over a darkened, blurred backdrop, per the user's own sketch.
        <div
          className="fixed inset-0 z-50 flex overflow-y-auto bg-foreground/30 p-4 backdrop-blur-sm"
          onClick={() => setConfirmClear(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm clearing codes"
        >
          <Card className="m-auto w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" /> Clear fault codes?
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p>
                This erases stored codes and resets readiness monitors. The scan above is already saved to
                history.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="destructive" onClick={doClear} disabled={clearMutation.isPending}>
                  {clearMutation.isPending ? "Clearing…" : "Yes, clear"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmClear(false)} disabled={clearMutation.isPending}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {String(error instanceof Error ? error.message : error)}
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
            <CodeList label="Stored" codes={scan.stored} onSelect={setDetailCode} />
            <CodeList label="Pending" codes={scan.pending} onSelect={setDetailCode} />
            <CodeList label="Permanent" codes={scan.permanent} onSelect={setDetailCode} />
            <p className="text-xs text-muted-foreground">Click any code for details, its history, and an AI deep-dive.</p>
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
          {historyQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : historyQuery.isError ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span>Could not load scan history.</span>
              <Button variant="outline" onClick={() => historyQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : history.length === 0 ? (
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
                        [...new Set([...h.stored, ...h.pending, ...h.permanent])].map((c) => (
                          <CodeBadge key={c} code={c} onSelect={setDetailCode} />
                        ))
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

      <AiReportCard hasAnyData={history.length > 0 || scan !== null} />

      {detailCode && (
        <DtcDetailModal code={detailCode} history={history} scan={scan} onClose={() => setDetailCode(null)} />
      )}
    </div>
  );
}
