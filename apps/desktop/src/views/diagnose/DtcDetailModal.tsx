import { Dialog, Kicker, Mono, Note, Pill } from "@/components/ui";
import type { DtcResult, DtcScanRow } from "@scainner/core";
import { decodeDtc, dtcInfo, localizedOrigin, localizedSubsystem, localizedSystem } from "@/lib/dtc";
import { FreezeFrame } from "@/views/diagnose/FreezeFrame";
import { useLocale, useT } from "@/i18n";
import { ReportAction } from "@/components/ReportAction";

export function DtcDetailModal({
  code,
  history,
  scan,
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
          <ReportAction input={{ kind: "code", dtc_code: code }} />
        </div>
      </div>
    </Dialog>
  );
}
