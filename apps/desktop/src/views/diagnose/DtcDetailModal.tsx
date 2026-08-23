import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { motion } from "framer-motion";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, useCyclingLabel } from "@/components/ui";
import type { DtcResult, DtcScanRow } from "@scainner/core";
import { AI_PHASES, generateCodeReport, getApiKey, getCodeReports, type SavedReport } from "@/lib/ai";
import { decodeDtc, dtcInfo, localizedOrigin, localizedSubsystem, localizedSystem } from "@/lib/dtc";
import { FreezeFrame } from "@/views/diagnose/FreezeFrame";
import { backdropVariants, modalPanelVariants } from "@/motion";
import { useLocale, useT } from "@/i18n";

// Per-code detail: everything the app knows about one DTC, from high level
// down — plain-language meaning (curated library), the code's
// structural anatomy (works for ANY code), its full occurrence timeline
// across scan history, the freeze frame if this code triggered one, ranked
// common causes/symptoms, and a focused AI deep-dive for exactly this
// fault on exactly this car.
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
  // Same stale-cache guard as AiReportCard.tsx — see lib/ai.ts's
  // SavedReport.lang comment.
  const validReport = report && report.lang === locale && report.vehicleId === vehicleId ? report : null;
  // Plain fetch outside `invoke`, no midpoint signal possible from the
  // Anthropic API — cycled phrases instead of a static label so a 10-60s
  // wait doesn't read as frozen (interaction-audit.md rule 3).
  const generatingLabel = useCyclingLabel(AI_PHASES, generating, 3500);

  const occurrences = history
    .filter((row) => row.stored.includes(code) || row.pending.includes(code) || row.permanent.includes(code))
    .map((row) => ({
      ts: row.ts,
      role: row.stored.includes(code) ? "stored" : row.pending.includes(code) ? "pending" : "permanent",
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

  const roleLabel: Record<"stored" | "pending" | "permanent", string> = {
    stored: t.diagnose.statusLabels.stored,
    pending: t.diagnose.statusLabels.pending,
    permanent: t.diagnose.statusLabels.permanent,
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/30 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t.diagnose.detailsFor(code)}
      initial="hidden"
      animate="visible"
      variants={backdropVariants}
    >
      <motion.div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()} variants={modalPanelVariants}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{code}</span>
            </CardTitle>
            {/* info?.title stays English in Phase 1 — DTC_LIBRARY content,
                Phase 3. */}
            <p className="mt-1 text-sm font-medium">{info?.title ?? t.diagnose.detailModal.notInLibrary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.diagnose.detailModal.close}
            className="rounded-md p-1 hover:bg-muted transition-transform active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {info && <p>{info.meaning}</p>}

          {structure && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="mb-1 font-medium">{t.diagnose.detailModal.codeAnatomy}</p>
              <ul className="flex flex-col gap-0.5 text-muted-foreground">
                <li>{t.diagnose.detailModal.system(localizedSystem(structure.system, locale))}</li>
                {structure.subsystem && (
                  <li>{t.diagnose.detailModal.area(localizedSubsystem(structure.subsystem, locale))}</li>
                )}
                <li>{localizedOrigin(structure.origin, locale)}</li>
              </ul>
            </div>
          )}

          <div>
            <p className="mb-1 font-medium">{t.diagnose.detailModal.whenItHappened}</p>
            {occurrences.length === 0 ? (
              <p className="text-muted-foreground">{t.diagnose.detailModal.notRecorded}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {occurrences.map((occ, index) => (
                  <li key={index} className="flex items-center justify-between border-b border-border py-1 last:border-0">
                    <span className="font-mono text-xs text-muted-foreground">{occ.ts} UTC</span>
                    <Badge variant={occ.role === "pending" ? "warn" : "error"}>{roleLabel[occ.role as "stored" | "pending" | "permanent"]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {freeze && <FreezeFrame data={freeze} />}

          {info && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 font-medium">{t.diagnose.detailModal.commonCauses}</p>
                <ol className="list-decimal pl-5 text-muted-foreground">
                  {info.causes.map((cause) => (
                    <li key={cause}>{cause}</li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="mb-1 font-medium">{t.diagnose.detailModal.typicalSymptoms}</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {info.symptoms.map((symptom) => (
                    <li key={symptom}>{symptom}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <Button onClick={doGenerate} disabled={generating || !hasKey}>
                <Sparkles className={"h-4 w-4" + (generating ? " animate-pulse" : "")} aria-hidden="true" />
                {generating
                  ? generatingLabel
                  : validReport
                    ? t.diagnose.detailModal.regenerateAiDeepDive
                    : t.diagnose.detailModal.aiDeepDive}
              </Button>
            </div>
            {!hasKey && <p className="text-xs text-muted-foreground">{t.diagnose.detailModal.setApiKeyHint}</p>}
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">{error}</div>
            )}
            {validReport && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="mb-2 font-mono text-xs text-muted-foreground">{t.diagnose.detailModal.generated(validReport.ts)}</p>
                <div className="whitespace-pre-wrap leading-relaxed">{validReport.md}</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      </motion.div>
    </motion.div>
  );
}
