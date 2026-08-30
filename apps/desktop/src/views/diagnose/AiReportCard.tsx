import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Card, CardHead, Field, Input, Mono, Note, SweepBar, useTransientLabel } from "@/components/ui";
import { Swap } from "@/motion/components";
import { generateDiagnosisReport, getApiKey, getLastReport, setApiKey, type SavedReport } from "@/lib/ai";
import { useLocale, useT } from "@/i18n";

// The written report: sends the backend's briefing (identity, scan history
// with freeze frames, sensor stats) to the model with the user's own key
// and renders what comes back. The key lives in localStorage only — see
// lib/ai.ts. One version today; the "for me / for the workshop" split waits
// on the server-side report.
export function AiReportCard({ hasAnyData, vehicleId }: { hasAnyData: boolean; vehicleId: number | null }) {
  const t = useT();
  const { locale } = useLocale();
  const [hasKey, setHasKey] = useState(() => !!getApiKey());
  const [keyDraft, setKeyDraft] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [report, setReport] = useState<SavedReport | null>(() => getLastReport());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validReport = report && report.lang === locale && report.vehicleId === vehicleId ? report : null;
  const [copyLabel, flashCopy] = useTransientLabel(1500);

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
      setReport(await generateDiagnosisReport(vehicleId, locale));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  };

  const doCopy = async () => {
    if (!validReport) return;
    await navigator.clipboard.writeText(validReport.md);
    flashCopy("copied");
  };

  const state = !hasKey || editingKey ? "key" : generating ? "generating" : validReport ? "done" : "idle";

  return (
    <Card className="gap-3">
      <CardHead
        icon={Sparkles}
        title={t.diagnose.v2.report.title}
        aside={
          state === "idle" ? (
            <Button variant="secondary" size="sm" onClick={doGenerate} disabled={!hasAnyData}>
              {t.diagnose.v2.report.writeUp}
            </Button>
          ) : undefined
        }
      />
      <Swap k={state} className="flex flex-col gap-3">
        {state === "key" && (
          <div className="flex flex-col gap-2.5">
            <Note className="max-w-[60ch]">{t.diagnose.v2.report.needsKey}</Note>
            <div className="flex items-end gap-2">
              <Field label={t.diagnose.v2.report.keyLabel} htmlFor="ai-key" className="w-72">
                <Input
                  id="ai-key"
                  type="password"
                  className="num"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={t.diagnose.aiReport.apiKeyPlaceholder}
                  aria-label={t.diagnose.aiReport.apiKeyAriaLabel}
                />
              </Field>
              <Button variant="primary" size="md" onClick={saveKey} disabled={!keyDraft.trim()}>
                {t.diagnose.v2.report.saveKey}
              </Button>
              {editingKey && (
                <Button variant="ghost" size="md" onClick={() => { setEditingKey(false); setKeyDraft(""); }}>
                  {t.common.cancel}
                </Button>
              )}
            </div>
          </div>
        )}
        {state === "idle" && (
          <Note className="max-w-[60ch]">{hasAnyData ? t.diagnose.v2.report.explainer : t.diagnose.aiReport.runScanFirst}</Note>
        )}
        {state === "generating" && (
          <div className="flex flex-col gap-[7px]">
            <Mono className="text-[12.5px] text-neutral-500">{t.diagnose.v2.report.generating}</Mono>
            <SweepBar />
          </div>
        )}
        {state === "done" && validReport && (
          <div className="flex flex-col gap-3">
            <Mono className="text-[11.5px] text-neutral-500">{t.diagnose.v2.report.generated(validReport.ts)}</Mono>
            <div className="max-w-[64ch] whitespace-pre-wrap text-[13.5px] leading-[1.6] text-neutral-200">{validReport.md}</div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={doCopy}>
                {copyLabel === "copied" ? t.diagnose.v2.report.copied : t.diagnose.v2.report.copy}
              </Button>
              <Button variant="ghost" size="sm" onClick={doGenerate}>
                {t.diagnose.v2.report.writeAgain}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingKey(true)}>
                {t.diagnose.v2.report.changeKey}
              </Button>
            </div>
          </div>
        )}
      </Swap>
      {error && <p className="text-[12px] text-stop">{error}</p>}
      {state === "idle" && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setEditingKey(true)}>
          {t.diagnose.v2.report.changeKey}
        </Button>
      )}
    </Card>
  );
}
