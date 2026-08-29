import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Hand, Loader2, RotateCcw, SkipForward } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { invoke } from "@/lib/tauri";
import { useT } from "@/i18n";
import { useGuidedSteps, type GuidedStep } from "@/views/lab/plan";

/**
 * Guided correlation (protocol phase 5). The app cannot press the brake or
 * turn the wheel, so it runs the loop around the person who can: one
 * instruction at a time, a capture of the open hypotheses on the module,
 * then a diff against the baseline. Bytes are never interpreted here — a
 * DID only earns "changed" when it is stable inside each condition and
 * differs between them. Every capture is saved as a verification run.
 *
 * The steps are not written here (multi-brand plan P4.2): the backend
 * generates the state tree (universal discovery protocol section 9) from
 * the vehicle's open hypotheses and its known facts, and this card renders
 * whatever it is handed — baseline, input, baseline — with the plan
 * version composed from the pack revision.
 */

type Reading = { did: string; payloads: Array<string | null>; stable: boolean; outcome: { status: string; nrc: number | null } };
type Capture = {
  run_id: number | null;
  plan_version: string;
  route: string;
  step: string;
  condition: string;
  repeats: number;
  readings: Reading[];
};

type Verdict = "changed" | "stable" | "noisy" | "missing";

function classify(baseline: Reading | undefined, current: Reading): Verdict {
  if (!baseline || baseline.payloads.every((p) => p == null) || current.payloads.every((p) => p == null)) return "missing";
  const base = baseline.payloads.filter((p): p is string => p != null);
  const now = current.payloads.filter((p): p is string => p != null);
  if (new Set(base).size !== 1) return "noisy";
  // A pressure or speed is stable at rest and varies with how hard the
  // input is applied: every sample left the baseline value, even if the
  // samples differ from each other. That is a change, not noise.
  if (now.every((p) => p !== base[0])) return "changed";
  return now.every((p) => p === base[0]) ? "stable" : "noisy";
}

const verdictVariant: Record<Verdict, "ok" | "warn" | "muted" | "error"> = {
  changed: "ok",
  stable: "muted",
  noisy: "warn",
  missing: "error",
};

export function GuidedCorrelation({ connected, vehicleId }: { connected: boolean; vehicleId: number | null }) {
  const t = useT();
  const tree = useGuidedSteps(vehicleId);
  const [moduleAddress, setModuleAddress] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSteps = useMemo(() => tree.data?.steps ?? [], [tree.data]);
  const modules = useMemo(() => {
    const seen: string[] = [];
    for (const s of allSteps) if (s.module && !seen.includes(s.module)) seen.push(s.module);
    return seen;
  }, [allSteps]);

  useEffect(() => {
    // Default to the module with the most steps to run.
    setModuleAddress((current) => {
      if (current && modules.includes(current)) return current;
      const counts = modules.map((m) => [m, allSteps.filter((s) => s.kind === "input" && s.module === m).length] as const);
      return counts.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    });
  }, [modules, allSteps]);

  // The tree is linear per module: baseline, input, baseline, …
  const script: GuidedStep[] = useMemo(
    () => allSteps.filter((s) => s.module === moduleAddress),
    [allSteps, moduleAddress],
  );
  const [req, resp] = moduleAddress?.split("/") ?? [null, null];
  const repeats = tree.data?.repeats ?? 3;
  const planVersion = tree.data?.plan_version ?? "";
  const step = script[stepIndex];
  const finished = script.length > 0 && stepIndex >= script.length;
  const baseline = captures.find((c) => c.condition === "baseline") ?? null;
  const latest = captures[captures.length - 1] ?? null;
  const targetDids = useMemo(() => (step?.capture.dids ?? []).map((d) => parseInt(d, 16)).filter((n) => Number.isFinite(n)), [step]);
  const needsConfirmation = step?.operator_confirmation != null && !confirmed.has(step.id);

  const capture = async () => {
    if (!req || !resp || !step) return;
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<Capture>("correlation_capture", {
        req,
        resp,
        dids: targetDids,
        step: step.id,
        condition: step.condition_label,
        planVersion,
        repeats,
      });
      setCaptures((all) => [...all, result]);
      setStepIndex((i) => i + 1);
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(false);
    }
  };

  const skip = () => setStepIndex((i) => {
    // Skipping an input also skips its return-to-baseline partner.
    const next = i + 1;
    return script[next]?.kind === "baseline" && script[i]?.kind !== "baseline" ? next + 1 : next;
  });

  const restart = () => {
    setCaptures([]);
    setStepIndex(0);
    setError(null);
  };

  // Per-condition candidates: DIDs that changed during the input AND came
  // back in the baseline captured right after it.
  const candidates = useMemo(() => {
    const out: Array<{ condition: string; did: string; before: string; during: string; returned: boolean }> = [];
    if (!baseline) return out;
    captures.forEach((c, i) => {
      if (c.condition === "baseline") return;
      const after = captures.slice(i + 1).find((x) => x.condition === "baseline");
      for (const reading of c.readings) {
        const base = baseline.readings.find((r) => r.did === reading.did);
        if (classify(base, reading) !== "changed") continue;
        const afterReading = after?.readings.find((r) => r.did === reading.did);
        out.push({
          condition: c.condition,
          did: reading.did,
          before: base?.payloads[0] ?? "",
          during: Array.from(new Set(reading.payloads.filter((p): p is string => p != null))).join(" / "),
          returned: afterReading != null && afterReading.stable && afterReading.payloads[0] === base?.payloads[0],
        });
      }
    });
    return out;
  }, [captures, baseline]);

  const diffRows = useMemo(() => {
    if (!latest || latest.condition === "baseline" || !baseline) return [];
    return latest.readings
      .map((r) => ({ reading: r, base: baseline.readings.find((b) => b.did === r.did), verdict: classify(baseline.readings.find((b) => b.did === r.did), r) }))
      .sort((a, b) => Number(b.verdict === "changed") - Number(a.verdict === "changed"));
  }, [latest, baseline]);

  const g = t.lab.guidedCorrelation;
  const preconditionText = (s: GuidedStep) => {
    const parts: string[] = [];
    if (s.optional) parts.push(g.preconditionMoves);
    else if (s.kind === "input") parts.push(g.preconditionStationary);
    if (typeof s.precondition.engine === "string") parts.push(g.preconditionEngine(s.precondition.engine));
    return parts.join(" ");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hand className="h-4 w-4" aria-hidden="true" /> {g.cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{g.explainer(repeats)}</p>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="corr-module" className="text-muted-foreground">{g.moduleLabel}</label>
          <select
            id="corr-module"
            className="rounded-md border border-border bg-background px-2 py-1"
            value={moduleAddress ?? ""}
            disabled={captures.length > 0 || modules.length === 0}
            onChange={(e) => { setModuleAddress(e.target.value); setStepIndex(0); }}
          >
            {modules.map((m) => (
              <option key={m} value={m}>{m} · {allSteps.filter((s) => s.kind === "input" && s.module === m).length}</option>
            ))}
          </select>
          {step && <span className="text-xs text-muted-foreground">{g.identifiersPerCapture(targetDids.length)}</span>}
        </div>

        {!connected && <p className="text-xs text-muted-foreground">{g.connectToStart}</p>}
        {connected && vehicleId == null && <p className="text-xs text-muted-foreground">{g.nameFirst}</p>}
        {connected && vehicleId != null && tree.isSuccess && allSteps.length === 0 && <p className="text-xs text-muted-foreground">{g.noSteps}</p>}

        {!finished && step && (
          <div className="rounded-md border border-border bg-muted/35 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">
                {g.stepOf(stepIndex + 1, script.length)} · {step.kind === "baseline" ? g.baselineTitle : step.hypotheses.join(", ")}
              </p>
              <span className="flex items-center gap-1">
                {step.optional && <Badge variant="muted">{g.optional}</Badge>}
                <Badge variant={step.kind === "baseline" ? "muted" : "default"}>{step.condition_label}</Badge>
              </span>
            </div>
            {preconditionText(step) && (
              <p className="mt-2 flex items-start gap-1 text-sm text-amber-700 dark:text-amber-400">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {preconditionText(step)}
              </p>
            )}
            <p className="mt-2 text-sm">{step.kind === "baseline" ? g.baselineInstruction : step.instruction}</p>
            {needsConfirmation && (
              <div className="mt-2 rounded-md border border-border bg-background p-2 text-sm">
                <p className="text-muted-foreground">{g.confirmPrompt}</p>
                <p className="mt-1">{step.operator_confirmation}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setConfirmed((s) => new Set(s).add(step.id))}>
                  {g.confirmYes}
                </Button>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={capture} disabled={!connected || vehicleId == null || !req || targetDids.length === 0 || busy || needsConfirmation}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                {busy ? g.reading(targetDids.length, repeats) : g.capture(step.condition_label)}
              </Button>
              {step.kind !== "baseline" && (
                <Button variant="outline" onClick={skip} disabled={busy}>
                  <SkipForward className="h-4 w-4" aria-hidden="true" /> {step.optional ? g.skipOptional : g.skip}
                </Button>
              )}
              {captures.length > 0 && (
                <Button variant="ghost" onClick={restart} disabled={busy}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> {g.restart}
                </Button>
              )}
            </div>
          </div>
        )}
        {finished && (
          <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
            <span>{g.complete(captures.length, planVersion)}</span>
            <Button variant="outline" onClick={restart}><RotateCcw className="h-4 w-4" aria-hidden="true" /> {g.newSession}</Button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {latest && (
          <p className="text-xs text-muted-foreground">
            {g.lastCapture(latest.condition, String(latest.run_id ?? "—"), latest.readings.filter((r) => r.stable).length, latest.readings.length, latest.repeats)}
          </p>
        )}

        {candidates.length > 0 && (
          <div>
            <p className="text-sm font-medium">{g.candidates}</p>
            <div className="mt-1 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-xs">
                <thead><tr className="text-muted-foreground"><th className="p-1.5">{g.thCondition}</th><th>{g.thDid}</th><th>{g.thBaseline}</th><th>{g.thDuring}</th><th>{g.thReturned}</th></tr></thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={`${c.condition}-${c.did}`} className="border-t border-border font-mono">
                      <td className="p-1.5">{c.condition}</td>
                      <td>{c.did}</td>
                      <td>{c.before}</td>
                      <td>{c.during}</td>
                      <td>{c.returned ? <Badge variant="ok">{g.yes}</Badge> : <Badge variant="muted">{g.notYet}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{g.candidateNote}</p>
          </div>
        )}

        {diffRows.length > 0 && (
          <details className="rounded-md border border-border p-3" open={diffRows.some((r) => r.verdict === "changed")}>
            <summary className="cursor-pointer text-sm">
              {g.diffSummary(latest?.condition ?? "", diffRows.filter((r) => r.verdict === "changed").length, diffRows.filter((r) => r.verdict === "noisy").length)}
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="text-muted-foreground"><th className="pb-1">{g.thDid}</th><th>{g.thBaseline}</th><th>{g.thThisStep}</th><th>{g.thVerdict}</th></tr></thead>
                <tbody>
                  {diffRows.map(({ reading, base, verdict }) => (
                    <tr key={reading.did} className="border-t border-border font-mono">
                      <td className="py-1 pr-3">{reading.did}</td>
                      <td className="py-1 pr-3">{base?.payloads.join(" · ") ?? "—"}</td>
                      <td className="py-1 pr-3">{reading.payloads.map((p) => p ?? "—").join(" · ")}</td>
                      <td className="py-1"><Badge variant={verdictVariant[verdict]}>{g.verdict[verdict]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
