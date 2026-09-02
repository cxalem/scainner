import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert } from "lucide-react";
import { Button, ExpanderButton, Kicker, Note, Pill, SweepBar, Table, Td, Th, Tr } from "@/components/ui";
import { Reveal, Swap } from "@/motion/components";
import { invoke } from "@/lib/tauri";
import { hex4 } from "@/shared/domain/gauges";
import { useT } from "@/i18n";
import { identityReads, sweepSize, useParkedPlan } from "@/views/lab/plan";
import { RunRow, RunSection, TargetRow } from "@/views/lab/RunRow";

type Outcome = {
  status: "answered" | "refused" | "timed_out" | "transport_failed" | "malformed";
  nrc: number | null;
  detail: string | null;
};

type CandidateInterpretation = {
  semantic: string | null;
  value: number;
  unit: string;
  quantity: string;
  variant_id: string;
  status: "research_hypothesis";
  claim_ids: string[];
  source_refs: string[];
};

type Report = {
  run_id: number | null;
  plan_version: string;
  safety: string;
  targets: Array<{
    key: string;
    label: string;
    expected_family: string;
    route: string;
    evidence_source: string;
    summary: string | null;
    observations: Array<{
      did: string;
      purpose: string;
      outcome: Outcome;
      payload_hex: string | null;
      printable: string | null;
      raw_response: string | null;
      candidate_interpretations?: CandidateInterpretation[];
    }>;
  }>;
};

const bandText = (sweep: Array<[number, number]>) =>
  sweep.length === 0 ? "" : sweep.map(([a, b]) => `0x${hex4(a)} – 0x${hex4(b)}`).join(" · ");

export function ParkedVerification({ connected, vehicleId }: { connected: boolean; vehicleId: number | null }) {
  const t = useT();
  const p = t.lab.parkedVerification;
  const plan = useParkedPlan(vehicleId);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const outcomeLabel = (outcome: Outcome) => {
    if (outcome.status === "refused" && outcome.nrc != null) return p.refused(outcome.nrc.toString(16).toUpperCase().padStart(2, "0"));
    return outcome.status.replace(/_/g, " ");
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setReport(await invoke<Report>("parked_verification"));
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setRunning(false);
    }
  };

  const targets = plan.data?.targets ?? [];
  const state = running ? "running" : report ? "done" : "idle";
  const totals = report
    ? report.targets.reduce(
        (acc, tg) => {
          for (const o of tg.observations) {
            if (o.outcome.status === "answered") acc.answered++;
            else if (o.outcome.status === "refused") acc.refused++;
            else acc.silent++;
          }
          return acc;
        },
        { answered: 0, refused: 0, silent: 0 },
      )
    : null;

  return (
    <>
      <RunSection>
        <RunRow
          label={running ? t.lab.run.running : report ? t.lab.run.runAgain : t.lab.run.run}
          onRun={() => void run()}
          busy={running}
          disabled={!connected || vehicleId == null || running || targets.length === 0}
          note={!connected ? t.lab.run.needsCable : vehicleId == null ? p.nameFirst : t.lab.run.noteParked}
        />
        {targets.length > 0 && (
          <Note className="text-[11.5px]">
            {p.step3(targets.length, identityReads(plan.data), sweepSize(plan.data))} {p.readOnly}
          </Note>
        )}
      </RunSection>

      <Swap k={state} className="flex flex-col gap-2 px-[17px] py-[15px]">
        {state === "idle" && (
          <>
            <Kicker>{t.lab.run.planTitlePlan}</Kicker>
            {targets.length === 0 && <Note>{plan.isPending && vehicleId != null ? "…" : t.lab.run.noPlan}</Note>}
            {targets.map((tg) => (
              <TargetRow
                key={tg.key}
                addr={tg.req}
                name={tg.label}
                detail={bandText(tg.sweep) || `${tg.dids.length} DIDs`}
                trailing={tg.sweep.length > 0 ? `${tg.dids.length} DIDs` : undefined}
              />
            ))}
          </>
        )}
        {state === "running" && (
          <>
            {targets.map((tg) => (
              <div key={tg.key} className="flex flex-col gap-1.5">
                <TargetRow addr={tg.req} name={tg.label} detail={p.running} />
                <SweepBar />
              </div>
            ))}
          </>
        )}
        {state === "done" && report && totals && (
          <>
            <div className="flex items-center gap-[9px] text-[13.5px]">
              <CheckCircle2 className="h-[17px] w-[17px] text-ok" aria-hidden="true" />
              <span>{t.lab.run.donePlan(totals.answered, totals.refused, totals.silent)}</span>
            </div>
            <Note className="text-[11.5px]">{p.savedAs(String(report.run_id ?? "—"), report.plan_version)}</Note>
            {report.targets.map((target) => {
              const answered = target.observations.filter((item) => item.outcome.status === "answered").length;
              const isOpen = open === target.key;
              return (
                <div key={target.key} className="flex flex-col gap-1.5 border-t border-neutral-900 pt-2.5">
                  <div className="flex items-center gap-[11px] text-[12.5px]">
                    <span className="num min-w-[26px] shrink-0 text-neutral-500">{target.route.split("/")[0]}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px]">{target.label}</span>
                      <span className="num text-[11.5px] text-neutral-500">{target.summary ?? p.expected(target.expected_family)}</span>
                    </span>
                    <Pill variant={answered > 0 ? "ok" : "info"}>{p.answered(answered, target.observations.length)}</Pill>
                    <ExpanderButton open={isOpen} onClick={() => setOpen(isOpen ? null : target.key)}>
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                    </ExpanderButton>
                  </div>
                  <Reveal when={isOpen}>
                    <Table className="text-[12px]">
                      <thead>
                        <tr>
                          <Th className="px-2">{p.thDid}</Th>
                          <Th className="px-2">{p.thPurpose}</Th>
                          <Th className="px-2">{p.thResult}</Th>
                          <Th className="px-2">{p.thEvidence}</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {target.observations.map((item) => (
                          <Tr key={item.did}>
                            <Td className="num px-2 py-1.5">{item.did}</Td>
                            <Td className="px-2 py-1.5">{item.purpose}</Td>
                            <Td className="px-2 py-1.5">
                              <span className="inline-flex items-center gap-1">
                                {item.outcome.status === "answered" ? (
                                  <CheckCircle2 className="h-3 w-3 text-ok" aria-hidden="true" />
                                ) : (
                                  <CircleAlert className="h-3 w-3 text-neutral-500" aria-hidden="true" />
                                )}
                                {outcomeLabel(item.outcome)}
                              </span>
                            </Td>
                            <Td className="max-w-80 break-all px-2 py-1.5 text-neutral-400" title={item.raw_response ?? item.payload_hex ?? item.outcome.detail ?? undefined}>
                              {(item.candidate_interpretations?.length ?? 0) > 0 ? (
                                <span className="flex flex-col gap-1">
                                  {item.candidate_interpretations?.map((candidate, index) => (
                                    <span key={`${candidate.claim_ids.join(":")}-${index}`} className="inline-flex flex-wrap items-center gap-1.5 text-neutral-200">
                                      <Pill variant="candidate">{p.candidate}</Pill>
                                      <span>{candidate.semantic ?? p.unknownMeaning}</span>
                                      <span className="num text-accent-2-400">
                                        {candidate.value.toLocaleString(undefined, { maximumFractionDigits: 3 })} {candidate.unit}
                                      </span>
                                      <span className="text-[10.5px] text-neutral-500">{p.claims(candidate.claim_ids.join(", "))}</span>
                                    </span>
                                  ))}
                                  <span className="num text-[10.5px] text-neutral-600">{item.payload_hex ?? item.raw_response?.trim()}</span>
                                </span>
                              ) : (
                                <span className="num">{item.printable ?? item.payload_hex ?? item.raw_response?.trim() ?? item.outcome.detail ?? "—"}</span>
                              )}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </Reveal>
                </div>
              );
            })}
            <div>
              <Button size="sm" onClick={() => setReport(null)}>
                {t.lab.run.planTitlePlan}
              </Button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-[12.5px] text-stop">
            {error}
          </p>
        )}
      </Swap>
    </>
  );
}
