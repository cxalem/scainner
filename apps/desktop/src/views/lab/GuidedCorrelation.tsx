import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Hand, Loader2, RotateCcw, SkipForward } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { invoke } from "@/lib/tauri";

/**
 * Guided correlation (protocol phase 5). The app cannot press the brake or
 * turn the wheel, so it runs the loop around the person who can: one
 * instruction at a time, a capture of every unlabeled identifier on the
 * module, then a diff against the baseline. Bytes are never interpreted
 * here — a DID only earns "changed" when it is stable inside each condition
 * and differs between them. Every capture is saved as a verification run.
 */

type ModuleRow = { id: number; address: string; name: string | null; did_count: number };
type DidRow = { did: number; label: string | null; confidence: string | null; byte_length: number | null };
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

type Step = {
  key: string;
  condition: string;
  title: string;
  instruction: string;
  precondition?: string;
  baseline?: boolean;
  optional?: boolean;
};

const PLAN_VERSION = "citroen-c41-corr-v1";
const REPEATS = 3;

const BASELINE: Step = {
  key: "baseline",
  condition: "baseline",
  title: "Baseline",
  instruction: "Hands off everything: no pedals, wheel centred, gear in P or neutral, parking brake on. Then capture.",
  baseline: true,
};

/** A → B → A: every physical input is followed by a return to baseline, so a
 *  byte must both move with the input and come back to count. */
const INPUTS: Step[] = [
  {
    key: "brake_held",
    condition: "brake_held",
    title: "Brake pedal held",
    instruction: "Press the brake pedal firmly and keep it held for the whole capture.",
  },
  {
    key: "steering_full_left",
    condition: "steering_full_left",
    title: "Steering fully left",
    instruction: "Turn the steering wheel all the way to the left and hold it there while capturing. The car stays still.",
  },
  {
    key: "steering_full_right",
    condition: "steering_full_right",
    title: "Steering fully right",
    instruction: "Turn the steering wheel all the way to the right and hold it while capturing.",
  },
  {
    key: "reverse_selected",
    condition: "reverse_selected",
    title: "Reverse selected, stationary",
    instruction: "With the brake held and the parking brake on, select R. Keep the car stationary while capturing, then return to P.",
    precondition: "Parking brake on. Nobody behind the car.",
  },
  {
    key: "rolled_forward",
    condition: "rolled_forward_2m",
    title: "Rolled forward two metres",
    instruction: "Release the parking brake, roll forward slowly about two metres, stop, apply the parking brake, and capture straight away.",
    precondition: "Only if the space ahead is clear and you are in the driver's seat. You are in control of the car, not the app.",
    optional: true,
  },
  {
    key: "rolled_backward",
    condition: "rolled_backward_2m",
    title: "Rolled backward two metres",
    instruction: "Reverse slowly about two metres, stop, apply the parking brake, and capture straight away.",
    precondition: "Only if the space behind is clear.",
    optional: true,
  },
];

const SCRIPT: Step[] = [BASELINE, ...INPUTS.flatMap((step, i) => [step, { ...BASELINE, key: `baseline_${i + 1}` }])];

// Tyre pressure is deliberately not a parked step on this platform. The ABS
// reports its software identifier as "DSG" (Détection de Sous-Gonflage):
// PSA's indirect system computes deflation from wheel speeds and only
// updates after several kilometres of driving, so it needs its own driven
// session (deflate one tyre ~0.5 bar → drive → capture → reset → drive →
// capture), planned as citroen-c41-corr-v2.

type Verdict = "changed" | "stable" | "noisy" | "missing";

function classify(baseline: Reading | undefined, current: Reading): Verdict {
  if (!baseline || baseline.payloads.every((p) => p == null) || current.payloads.every((p) => p == null)) return "missing";
  const base = baseline.payloads.filter((p): p is string => p != null);
  const now = current.payloads.filter((p): p is string => p != null);
  if (new Set(base).size !== 1) return "noisy";
  // A pressure or speed is stable at rest and varies with how hard the
  // input is applied: every sample left the baseline value, even if the
  // samples differ from each other. That is a change, not noise (C4 session
  // 2026-08-27: brake pressure D40C went 00 → 1E/20/23 and was mislabelled).
  if (now.every((p) => p !== base[0])) return "changed";
  return now.every((p) => p === base[0]) ? "stable" : "noisy";
}

const verdictBadge: Record<Verdict, { label: string; variant: "ok" | "warn" | "muted" | "error" }> = {
  changed: { label: "changed", variant: "ok" },
  stable: { label: "stable", variant: "muted" },
  noisy: { label: "noisy", variant: "warn" },
  missing: { label: "no answer", variant: "error" },
};

export function GuidedCorrelation({ connected, vehicleId }: { connected: boolean; vehicleId: number | null }) {
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [dids, setDids] = useState<DidRow[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (vehicleId == null) return;
    invoke<ModuleRow[]>("discovered_modules", { vehicleId }).then((rows) => {
      const withDids = rows.filter((m) => m.did_count > 0);
      setModules(withDids);
      // Default to the module with the most unlabeled data — on the C4 that
      // is the ABS/ESP after the v3 sweep.
      setModuleId((current) => current ?? withDids.sort((a, b) => b.did_count - a.did_count)[0]?.id ?? null);
    }).catch(() => setModules([]));
  }, [vehicleId]);

  useEffect(() => {
    if (moduleId == null) return;
    invoke<DidRow[]>("discovered_dids", { moduleId }).then(setDids).catch(() => setDids([]));
  }, [moduleId]);

  const module = modules.find((m) => m.id === moduleId) ?? null;
  const [req, resp] = module?.address.split("/") ?? [null, null];
  const targetDids = useMemo(() => dids.filter((d) => d.confidence !== "confirmed").map((d) => d.did), [dids]);
  const step = SCRIPT[stepIndex];
  const finished = stepIndex >= SCRIPT.length;
  const baseline = captures.find((c) => c.condition === "baseline") ?? null;
  const latest = captures[captures.length - 1] ?? null;

  const capture = async () => {
    if (!req || !resp || !step) return;
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<Capture>("correlation_capture", {
        req,
        resp,
        dids: targetDids,
        step: step.key,
        condition: step.condition,
        planVersion: PLAN_VERSION,
        repeats: REPEATS,
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
    return SCRIPT[next]?.baseline && !SCRIPT[i]?.baseline ? next + 1 : next;
  });

  const restart = () => {
    setCaptures([]);
    setStepIndex(0);
    setError(null);
  };

  // Per-condition candidates: DIDs that changed during the input AND came
  // back in the baseline captured right after it.
  const candidates = useMemo(() => {
    if (!baseline) return [] as Array<{ condition: string; did: string; before: string; during: string; returned: boolean }>;
    const out: Array<{ condition: string; did: string; before: string; during: string; returned: boolean }> = [];
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hand className="h-4 w-4" aria-hidden="true" /> Guided correlation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The app reads every unlabeled identifier on one module {REPEATS}× while you hold one physical condition, then compares it with the baseline. A byte only counts when it moves with your input and returns afterwards. Read-only; you stay in control of the car.
        </p>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="corr-module" className="text-muted-foreground">Module</label>
          <select
            id="corr-module"
            className="rounded-md border border-border bg-background px-2 py-1"
            value={moduleId ?? ""}
            disabled={captures.length > 0}
            onChange={(e) => setModuleId(Number(e.target.value))}
          >
            {modules.map((m) => (
              <option key={m.id} value={m.id}>{m.name ?? m.address} · {m.address} · {m.did_count} DIDs</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">{targetDids.length} unlabeled identifiers will be read per capture</span>
        </div>

        {!connected && <p className="text-xs text-muted-foreground">Connect to the car to start.</p>}
        {connected && vehicleId == null && <p className="text-xs text-muted-foreground">Name the connected vehicle first so captures are stored against the right car.</p>}
        {connected && vehicleId != null && modules.length === 0 && <p className="text-xs text-muted-foreground">No module has discovered identifiers yet. Run a verification with a sweep first.</p>}

        {!finished && step && (
          <div className="rounded-md border border-border bg-muted/35 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">Step {stepIndex + 1} of {SCRIPT.length} · {step.title}</p>
              <Badge variant={step.baseline ? "muted" : "default"}>{step.condition}</Badge>
            </div>
            {step.precondition && (
              <p className="mt-2 flex items-start gap-1 text-sm text-amber-700 dark:text-amber-400">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {step.precondition}
              </p>
            )}
            <p className="mt-2 text-sm">{step.instruction}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={capture} disabled={!connected || vehicleId == null || !module || targetDids.length === 0 || busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                {busy ? `Reading ${targetDids.length} identifiers ${REPEATS}×…` : `Capture ${step.condition}`}
              </Button>
              {!step.baseline && (
                <Button variant="outline" onClick={skip} disabled={busy}>
                  <SkipForward className="h-4 w-4" aria-hidden="true" /> Skip{step.optional ? " (optional)" : ""}
                </Button>
              )}
              {captures.length > 0 && (
                <Button variant="ghost" onClick={restart} disabled={busy}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Restart session
                </Button>
              )}
            </div>
          </div>
        )}
        {finished && (
          <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
            <span>Session complete · {captures.length} captures saved under {PLAN_VERSION}</span>
            <Button variant="outline" onClick={restart}><RotateCcw className="h-4 w-4" aria-hidden="true" /> New session</Button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {latest && (
          <p className="text-xs text-muted-foreground">
            Last capture: <span className="font-mono">{latest.condition}</span> · evidence run #{latest.run_id ?? "—"} ·{" "}
            {latest.readings.filter((r) => r.stable).length}/{latest.readings.length} identifiers stable across {latest.repeats} reads
          </p>
        )}

        {candidates.length > 0 && (
          <div>
            <p className="text-sm font-medium">Candidates so far</p>
            <div className="mt-1 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-xs">
                <thead><tr className="text-muted-foreground"><th className="p-1.5">Condition</th><th>DID</th><th>Baseline</th><th>During</th><th>Returned</th></tr></thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={`${c.condition}-${c.did}`} className="border-t border-border font-mono">
                      <td className="p-1.5">{c.condition}</td>
                      <td>{c.did}</td>
                      <td>{c.before}</td>
                      <td>{c.during}</td>
                      <td>{c.returned ? <Badge variant="ok">yes</Badge> : <Badge variant="muted">not yet</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">A candidate becomes a sensor only after the same input moves the same byte in a repeat session and a decode is written. Nothing here is polled automatically.</p>
          </div>
        )}

        {diffRows.length > 0 && (
          <details className="rounded-md border border-border p-3" open={diffRows.some((r) => r.verdict === "changed")}>
            <summary className="cursor-pointer text-sm">
              Diff of <span className="font-mono">{latest?.condition}</span> against baseline · {diffRows.filter((r) => r.verdict === "changed").length} changed, {diffRows.filter((r) => r.verdict === "noisy").length} noisy
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="text-muted-foreground"><th className="pb-1">DID</th><th>Baseline</th><th>This step</th><th>Verdict</th></tr></thead>
                <tbody>
                  {diffRows.map(({ reading, base, verdict }) => (
                    <tr key={reading.did} className="border-t border-border font-mono">
                      <td className="py-1 pr-3">{reading.did}</td>
                      <td className="py-1 pr-3">{base?.payloads.join(" · ") ?? "—"}</td>
                      <td className="py-1 pr-3">{reading.payloads.map((p) => p ?? "—").join(" · ")}</td>
                      <td className="py-1"><Badge variant={verdictBadge[verdict].variant}>{verdictBadge[verdict].label}</Badge></td>
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
