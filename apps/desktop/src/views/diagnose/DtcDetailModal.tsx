import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Dialog, Kicker, Mono, Note, Pill, useCyclingLabel } from "@/components/ui";
import type { DtcResult, DtcScanRow } from "@scainner/core";
import { AI_PHASES, generateCodeReport, getApiKey, getCodeReports, type SavedReport } from "@/lib/ai";
import { decodeDtc, dtcInfo, localizedOrigin, localizedSubsystem, localizedSystem } from "@/lib/dtc";
import { FreezeFrame } from "@/views/diagnose/FreezeFrame";
import { useLocale, useT } from "@/i18n";

export function DtcDetailModal({
  code,
  history,
  scan,
  vehicleId,
  onClose,
}: {
  code: string;
  history: DtcScanRow[];
  scan: DtcResult | null;
  vehicleId: number | null;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const info = dtcInfo(code, locale);
  const structure = decodeDtc(code);
  const [report, setReport] = useState<SavedReport | null>(() => getCodeReports()[`${vehicleId ?? "unidentified"}:${code}`] ?? null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasKey = !!getApiKey();
  const validReport = report && report.lang === locale && report.vehicleId === vehicleId ? report : null;
  const generatingLabel = useCyclingLabel(AI_PHASES, generating, 3500);

  const occurrences = history
    .filter((row) => row.stored.includes(code) || row.pending.includes(code) || row.permanent.includes(code))
    .map((row) => ({
      ts: row.ts,
      role: (row.stored.includes(code) ? "stored" : row.pending.includes(code) ? "pending" : "permanent") as "stored" | "pending" | "permanent",
      voltage: row.voltage,
    }));

  const freeze =
    scan?.freeze && String((scan.freeze as Record<string, unknown>).trigger_dtc) === code
      ? (scan.freeze as Record<string, unknown>)
      : (history.find((row) => row.freeze && String((row.freeze as Record<string, unknown>).trigger_dtc) === code)
          ?.freeze as Record<string, unknown> | undefined) ?? null;

  const doGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const summary =
        occurrences.map((occ) => `- ${occ.ts} UTC — seen as ${occ.role}${occ.voltage != null ? ` (battery ${occ.voltage.toFixed(1)} V)` : ""}`).join("\n") +
        (freeze ? `\nFreeze frame at the moment it tripped: ${JSON.stringify(freeze)}` : "");
      setReport(
        await generateCodeReport(vehicleId, code, summary || "(no recorded occurrences — code seen in a live scan only)", locale),
      );
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={640}
      title={
        <span className="flex items-baseline gap-2.5">
          <Mono>{code}</Mono>
          <span className="text-[13.5px] font-normal text-neutral-400">{info?.title ?? t.diagnose.detailModal.notInLibrary}</span>
        </span>
      }
    >
      <div className="flex max-h-[70vh] flex-col gap-[13px] overflow-y-auto pr-1 text-[13px]">
        {info && <p className="max-w-[62ch] leading-[1.6] text-neutral-200">{info.meaning}</p>}

        {structure && (
          <div className="flex flex-col gap-1">
            <Kicker>{t.diagnose.detailModal.codeAnatomy}</Kicker>
            <span className="text-neutral-300">{t.diagnose.detailModal.system(localizedSystem(structure.system, locale))}</span>
            {structure.subsystem && <span className="text-neutral-300">{t.diagnose.detailModal.area(localizedSubsystem(structure.subsystem, locale))}</span>}
            <span className="text-neutral-500">{localizedOrigin(structure.origin, locale)}</span>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Kicker>{t.diagnose.detailModal.whenItHappened}</Kicker>
          {occurrences.length === 0 ? (
            <Note>{t.diagnose.detailModal.notRecorded}</Note>
          ) : (
            occurrences.map((occ, i) => (
              <div key={i} className="flex items-center justify-between border-b border-neutral-900 py-1 last:border-0">
                <Mono className="text-[11.5px] text-neutral-500">{occ.ts} UTC</Mono>
                <Pill variant={occ.role === "pending" ? "info" : "warn"}>{t.diagnose.statusLabels[occ.role]}</Pill>
              </div>
            ))
          )}
        </div>

        {freeze && <FreezeFrame data={freeze} />}

        {info && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-[5px]">
              <Kicker>{t.diagnose.detailModal.commonCauses}</Kicker>
              {info.causes.map((c, i) => (
                <div key={c} className="flex gap-[9px] leading-[1.5]">
                  <span className="text-accent-600">{i + 1}.</span>
                  <span className="text-neutral-300">{c}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-[5px]">
              <Kicker>{t.diagnose.detailModal.typicalSymptoms}</Kicker>
              {info.symptoms.map((s) => (
                <span key={s} className="text-neutral-300">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-divider pt-3">
          <div>
            <Button variant="secondary" size="sm" icon={Sparkles} busy={generating} onClick={doGenerate} disabled={!hasKey}>
              {generating ? generatingLabel : validReport ? t.diagnose.detailModal.regenerateAiDeepDive : t.diagnose.detailModal.aiDeepDive}
            </Button>
          </div>
          {!hasKey && <Note className="text-[12px]">{t.diagnose.detailModal.setApiKeyHint}</Note>}
          {error && <p className="text-[12px] text-stop">{error}</p>}
          {validReport && (
            <div className="flex flex-col gap-2 rounded-sm bg-bg p-3">
              <Mono className="text-[11.5px] text-neutral-500">{t.diagnose.detailModal.generated(validReport.ts)}</Mono>
              <div className="whitespace-pre-wrap leading-[1.6] text-neutral-200">{validReport.md}</div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
