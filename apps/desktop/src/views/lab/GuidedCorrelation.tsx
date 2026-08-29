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
 * the vehicle's open hypotheses and its known facts — one independent
 * triplet per experiment, `baseline_before_<i>` / `input_<i>` /
 * `baseline_after_<i>`, all on the input's module and DID set. Captures
 * are keyed by step id, an input is diffed against ITS before-baseline and
 * "returned" is judged against ITS after-baseline. Reference DIDs a step
 * names on other modules are read right before and right after the
 * primary capture and stored with it.
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
/** `[before, after]` hex payloads of one reference DID; null = no answer. */
type ReferenceReads = Record<string, Record<string, [string | null, string | null]>>;
type StoredCapture = Capture & { step_id: string; references: ReferenceReads; reference_errors: string[] };
type UdsHit = { did: number; hex: string; ascii: string };

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

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
/** `REQ/RESP` address → the `/uds/modules` key the backend routes by. */
const moduleKey = (address: string) => address.replace("/", "_").toLowerCase();

/** The before/after baselines of an input, by position in its triplet. */
function tripletOf(script: GuidedStep[], index: number): { before: GuidedStep | null; after: GuidedStep | null } {
  const step = script[index];
  if (!step || step.kind !== "input") return { before: null, after: null };
  const before = script[index - 1]?.kind === "baseline" ? script[index - 1] : null;
  const after = script[index + 1]?.kind === "baseline" ? script[index + 1] : null;
  return { before, after };
}

export function GuidedCorrelation({ connected, vehicleId }: { connected: boolean; vehicleId: number | null }) {
  const t = useT();
  const tree = useGuidedSteps(vehicleId);
  const [moduleAddress, setModuleAddress] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [captures, setCaptures] = useState<StoredCapture[]>([]);
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
    // Default to the module with the most experiments to run.
    setModuleAddress((current) => {
      if (current && modules.includes(current)) return current;
      const counts = modules.map((m) => [m, allSteps.filter((s) => s.kind === "input" && s.module === m).length] as const);
      return counts.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    });
  }, [modules, allSteps]);

  // Triplets share one module, so filtering by module keeps them whole.
  const script: GuidedStep[] = useMemo(
    () => allSteps.filter((s) => s.module === moduleAddress),
    [allSteps, moduleAddress],
  );
  const [req, resp] = moduleAddress?.split("/") ?? [null, null];
  const repeats = tree.data?.repeats ?? 3;
  const planVersion = tree.data?.plan_version ?? "";
  const step = script[stepIndex];
  const finished = script.length > 0 && stepIndex >= script.length;
  const latest = captures[captures.length - 1] ?? null;
  const byStep = useMemo(() => new Map(captures.map((c) => [c.step_id, c])), [captures]);
  const targetDids = useMemo(() => (step?.capture.dids ?? []).map((d) => parseInt(d, 16)).filter((n) => Number.isFinite(n)), [step]);
  const needsConfirmation = step?.operator_confirmation != null && !confirmed.has(step.id);

  const readReferences = async (s: GuidedStep): Promise<{ reads: Record<string, Record<string, string | null>>; errors: string[] }> => {
    const reads: Record<string, Record<string, string | null>> = {};
    const errors: string[] = [];
    for (const [address, dids] of Object.entries(s.capture.reference_dids)) {
      const wanted = dids.map((d) => parseInt(d, 16)).filter((n) => Number.isFinite(n));
      if (wanted.length === 0) continue;
      try {
        const hits = await invoke<UdsHit[]>("uds_read_many", { module: moduleKey(address), dids: wanted });
        reads[address] = Object.fromEntries(wanted.map((d) => [hex4(d), hits.find((h) => h.did === d)?.hex ?? null]));
      } catch (cause) {
        errors.push(`${address}: ${String(cause instanceof Error ? cause.message : cause)}`);
      }
    }
    return { reads, errors };
  };

  const capture = async () => {
    if (!req || !resp || !step) return;
    setBusy(true);
    setError(null);
    try {
      const before = await readReferences(step);
      const result = await invoke<Capture>("correlation_capture", {
        req,
        resp,
        dids: targetDids,
        step: step.id,
        condition: step.condition_label,
        planVersion,
        repeats,
      });
      const after = await readReferences(step);
      const references: ReferenceReads = {};
      for (const address of new Set([...Object.keys(before.reads), ...Object.keys(after.reads)])) {
        references[address] = {};
        for (const did of new Set([...Object.keys(before.reads[address] ?? {}), ...Object.keys(after.reads[address] ?? {})])) {
          references[address][did] = [before.reads[address]?.[did] ?? null, after.reads[address]?.[did] ?? null];
        }
      }
      setCaptures((all) => [...all, { ...result, step_id: step.id, references, reference_errors: [...before.errors, ...after.errors] }]);
      setStepIndex((i) => i + 1);
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(false);
    }
  };

  const skip = () => setStepIndex((i) => {
    // Skipping an input also skips its after-baseline: the triplet is one
    // experiment, and half of one is no evidence.
    const next = i + 1;
    return script[next]?.kind === "baseline" && script[i]?.kind === "input" ? next + 1 : next;
  });

  const restart = () => {
    setCaptures([]);
    setStepIndex(0);
    setError(null);
  };

  // Per-experiment candidates: DIDs that changed during the input against
  // its own before-baseline AND came back in its own after-baseline.
  const candidates = useMemo(() => {
    const out: Array<{ condition: string; did: string; before: string; during: string; returned: boolean }> = [];
    script.forEach((s, i) => {
      if (s.kind !== "input") return;
      const c = byStep.get(s.id);
      const { before: beforeStep, after: afterStep } = tripletOf(script, i);
      const before = beforeStep ? byStep.get(beforeStep.id) : undefined;
      const after = afterStep ? byStep.get(afterStep.id) : undefined;
      if (!c || !before) return;
      for (const reading of c.readings) {
        const base = before.readings.find((r) => r.did === reading.did);
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
  }, [script, byStep]);

  // Diff of the latest input against ITS before-baseline.
  const latestDiff = useMemo(() => {
    const idx = script.findIndex((s) => s.id === latest?.step_id);
    if (!latest || idx < 0 || script[idx].kind !== "input") return null;
    const beforeStep = tripletOf(script, idx).before;
    const before = beforeStep ? byStep.get(beforeStep.id) : undefined;
    if (!before) return null;
    const rows = latest.readings
      .map((r) => ({ reading: r, base: before.readings.find((b) => b.did === r.did), verdict: classify(before.readings.find((b) => b.did === r.did), r) }))
      .sort((a, b) => Number(b.verdict === "changed") - Number(a.verdict === "changed"));
    return { capture: latest, rows };
  }, [latest, script, byStep]);

  const g = t.lab.guidedCorrelation;
  const preconditionText = (s: GuidedStep) => {
    const parts: string[] = [];
    if (s.optional) parts.push(g.preconditionMoves);
    else if (s.kind === "input") parts.push(g.preconditionStationary);
    if (typeof s.precondition.engine === "string") parts.push(g.preconditionEngine(s.precondition.engine));
    return parts.join(" ");
  };
  const referenceRows = (c: StoredCapture) =>
    Object.entries(c.references).flatMap(([address, dids]) => Object.entries(dids).map(([did, [b, a]]) => ({ address, did, before: b, after: a })));

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
                <Badge variant={step.kind === "baseline" ? "muted" : "default"}>{step.id}</Badge>
              </span>
            </div>
            {preconditionText(step) && (
              <p className="mt-2 flex items-start gap-1 text-sm text-amber-700 dark:text-amber-400">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {preconditionText(step)}
              </p>
            )}
            <p className="mt-2 text-sm">{step.kind === "baseline" ? g.baselineInstruction : step.instruction}</p>
            {Object.keys(step.capture.reference_dids).length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {g.references}: {Object.entries(step.capture.reference_dids).map(([m, d]) => `${m} ${d.join(", ")}`).join(" · ")}
              </p>
            )}
            {needsConfirmation && (
              <div className="mt-2 rounded-md border border-border bg-background p-2 text-sm">
                <p className="text-muted-foreground">{g.confirmPrompt}</p>
                <p className="mt-1">{step.operator_confirmation}</p>
                <Button variant="outline" className="mt-2" onClick={() => setConfirmed((s) => new Set(s).add(step.id))}>
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
            {g.lastCapture(latest.step_id, String(latest.run_id ?? "—"), latest.readings.filter((r) => r.stable).length, latest.readings.length, latest.repeats)}
          </p>
        )}
        {latest && latest.reference_errors.length > 0 && (
          <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
            {g.referenceUnreachable}: {latest.reference_errors.join(" · ")}
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

        {latestDiff && latestDiff.rows.length > 0 && (
          <details className="rounded-md border border-border p-3" open={latestDiff.rows.some((r) => r.verdict === "changed")}>
            <summary className="cursor-pointer text-sm">
              {g.diffSummary(latestDiff.capture.step_id, latestDiff.rows.filter((r) => r.verdict === "changed").length, latestDiff.rows.filter((r) => r.verdict === "noisy").length)}
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="text-muted-foreground"><th className="pb-1">{g.thDid}</th><th>{g.thBaseline}</th><th>{g.thThisStep}</th><th>{g.thVerdict}</th></tr></thead>
                <tbody>
                  {latestDiff.rows.map(({ reading, base, verdict }) => (
                    <tr key={reading.did} className="border-t border-border font-mono">
                      <td className="py-1 pr-3">{reading.did}</td>
                      <td className="py-1 pr-3">{base?.payloads.join(" · ") ?? "—"}</td>
                      <td className="py-1 pr-3">{reading.payloads.map((p) => p ?? "—").join(" · ")}</td>
                      <td className="py-1"><Badge variant={verdictVariant[verdict]}>{g.verdict[verdict]}</Badge></td>
                    </tr>
                  ))}
                  {referenceRows(latestDiff.capture).map((r) => (
                    <tr key={`${r.address}-${r.did}`} className="border-t border-border font-mono text-muted-foreground">
                      <td className="py-1 pr-3">{r.address} {r.did}</td>
                      <td className="py-1 pr-3">{r.before ?? "—"}</td>
                      <td className="py-1 pr-3">{r.after ?? "—"}</td>
                      <td className="py-1"><Badge variant="muted">{g.reference}</Badge></td>
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
