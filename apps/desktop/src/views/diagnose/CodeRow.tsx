import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kicker, Mono, Pill } from "@/components/ui";
import { Reveal } from "@/motion/components";
import { dtcInfo, decodeDtc, localizedSystem } from "@/lib/dtc";
import { GAUGES, gaugeLabel } from "@/shared/domain/gauges";
import type { DtcScanRow } from "@scainner/core";
import { useLocale, useT } from "@/i18n";

export type CodeStatus = "stored" | "pending" | "permanent";

// Drivability, not repair cost — and only what the app can honestly say:
// pending = the car saw it once and has not confirmed it; stored/permanent
// = confirmed, worth a look. Nothing here claims "stop driving": the
// library has no severity field, and a guessed one would be a judgment
// the app can't back (owner call, 2026-08-21).
export function severityOf(status: CodeStatus): "watch" | "info" {
  return status === "pending" ? "info" : "watch";
}

function freezeSummary(freeze: Record<string, unknown>, locale: "en" | "es"): string {
  return Object.entries(freeze)
    .filter(([k]) => k !== "trigger_dtc")
    .slice(0, 4)
    .map(([k, v]) => {
      const g = GAUGES.find((c) => c.key === k);
      const val = typeof v === "number" ? (g?.fmt ? g.fmt(v) : v) : String(v);
      return `${g ? gaugeLabel(k, locale) : k} ${val}${g?.unit ? ` ${g.unit}` : ""}`;
    })
    .join(" · ");
}

// One fault code: a row that opens into what it means, what usually causes
// it, what you'd notice, and the evidence the car itself gave. Every claim
// comes from the offline library or from the scan; where the library has
// nothing, the section is simply absent.
export function CodeRow({
  code,
  status,
  open,
  onToggle,
  history,
  freeze,
  voltageLinked,
}: {
  code: string;
  status: CodeStatus;
  open: boolean;
  onToggle: () => void;
  history: DtcScanRow[];
  freeze: Record<string, unknown> | null;
  voltageLinked: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const info = dtcInfo(code, locale);
  const structure = decodeDtc(code);
  const sev = severityOf(status);
  const occurrences = history.filter((r) => r.stored.includes(code) || r.pending.includes(code) || r.permanent.includes(code));
  const seen = Math.max(occurrences.length, 1);
  const isStandard = structure ? structure.origin.startsWith("SAE") : true;
  const statusLabel = t.diagnose.statusLabels[status];
  const sub = [isStandard ? t.diagnose.v2.source.standard : t.diagnose.v2.source.module, statusLabel.toLowerCase(), t.diagnose.v2.seen(seen)].join(" · ");
  const Caret = open ? ChevronUp : ChevronDown;
  const rowFreeze = freeze && String(freeze.trigger_dtc) === code ? freeze : null;

  const evidence: string[] = [];
  if (rowFreeze) evidence.push(t.diagnose.v2.evidenceFreeze(freezeSummary(rowFreeze, locale)));
  evidence.push(t.diagnose.v2.evidenceStatus(statusLabel.toLowerCase()));
  if (occurrences.length >= 2) {
    evidence.push(t.diagnose.v2.evidenceFirst(occurrences[occurrences.length - 1]!.ts, occurrences[0]!.ts));
  } else if (occurrences.length === 1) {
    evidence.push(t.diagnose.v2.evidenceOnce(occurrences[0]!.ts));
  }

  return (
    <div className="flex flex-col border-b border-neutral-900 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-[13px] px-[17px] py-[13px] text-left transition-colors hover:bg-accent-900",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        )}
      >
        <span className={cn("h-[30px] w-[3px] shrink-0 rounded-[2px]", sev === "watch" ? "bg-warn-line" : "bg-neutral-700")} aria-hidden="true" />
        {/* min-w: standard DTCs are a fixed 5 chars, but a manufacturer UDS
            fault code isn't guaranteed to be — never let a fixed w risk
            painting over the title column beside it. */}
        <Mono className="min-w-[62px] shrink-0 text-[14px]">{code}</Mono>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13.5px]">{info?.title ?? (structure ? localizedSystem(structure.system, locale) : t.diagnose.groups.notInLibrary)}</span>
          <span className="text-[11.5px] text-neutral-500">
            {sub}
            {voltageLinked && ` · ${t.diagnose.groups.voltageLinked}`}
          </span>
        </span>
        <Pill variant={sev === "watch" ? "warn" : "info"}>{t.diagnose.v2.severity[sev]}</Pill>
        <Caret className="h-[15px] w-[15px] shrink-0 text-neutral-600" aria-hidden="true" />
      </button>
      <Reveal when={open}>
        <div className="flex flex-col gap-[13px] px-[17px] pb-[17px] pl-[95px] pt-0.5">
          {info && (
            <div className="flex flex-col gap-1">
              <Kicker>{t.diagnose.v2.whatItMeans}</Kicker>
              <p className="max-w-[62ch] text-[13.5px] leading-[1.6] text-neutral-200">{info.meaning}</p>
            </div>
          )}
          {info && info.causes.length > 0 && (
            <div className="flex flex-col gap-[5px]">
              <Kicker>{t.diagnose.v2.causes}</Kicker>
              {info.causes.map((c, i) => (
                <div key={c} className="flex gap-[9px] text-[13px] leading-[1.5]">
                  <span className="text-accent-600">{i + 1}.</span>
                  <span className="text-neutral-300">{c}</span>
                </div>
              ))}
            </div>
          )}
          {info && info.symptoms.length > 0 && (
            <div className="flex flex-col gap-1 border-l-2 border-accent-600 pl-[13px]">
              <Kicker>{t.diagnose.v2.symptoms}</Kicker>
              <p className="max-w-[60ch] text-[13.5px] leading-[1.6] text-neutral-200">{info.symptoms.join(" · ")}</p>
            </div>
          )}
          {!info && structure && (
            <div className="flex flex-col gap-1">
              <Kicker>{t.diagnose.detailModal.codeAnatomy}</Kicker>
              <p className="max-w-[62ch] text-[13px] leading-[1.6] text-neutral-300">{localizedSystem(structure.system, locale)}</p>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Kicker>{t.diagnose.v2.evidence}</Kicker>
            {evidence.map((e) => (
              <Mono key={e} className="text-[12px] text-neutral-400">
                {e}
              </Mono>
            ))}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
