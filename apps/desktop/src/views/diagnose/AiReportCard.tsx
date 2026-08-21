import { useState } from "react";
import { Copy, Info, Sparkles } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, useCyclingLabel, useTransientLabel } from "@/components/ui";
import {
  AI_PHASES,
  generateDiagnosisReport,
  getApiKey,
  getLastReport,
  setApiKey,
  type SavedReport,
} from "@/lib/ai";
import { useT } from "@/i18n";

// AI diagnosis card: sends the backend's `ai_context` briefing (car
// identity, DTC scan history with freeze frames, sensor stats) to the
// Anthropic API with the user's own key and renders the returned report.
// The key lives in localStorage only — see src/lib/ai.ts for why not the DB.
export function AiReportCard({ hasAnyData }: { hasAnyData: boolean }) {
  const t = useT();
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
          <Sparkles className="h-4 w-4" aria-hidden="true" /> {t.diagnose.aiReport.cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!hasKey || editingKey ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t.diagnose.aiReport.needsKeyExplainer}</p>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder={t.diagnose.aiReport.apiKeyPlaceholder}
                className="w-64 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm"
                aria-label={t.diagnose.aiReport.apiKeyAriaLabel}
              />
              <Button onClick={saveKey} disabled={!keyDraft.trim() && !editingKey}>
                {t.diagnose.aiReport.saveKey}
              </Button>
              {editingKey && (
                <Button variant="ghost" onClick={() => { setEditingKey(false); setKeyDraft(""); }}>
                  {t.common.cancel}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={doGenerate} disabled={generating || !hasAnyData}>
                <Sparkles className={"h-4 w-4" + (generating ? " animate-pulse" : "")} aria-hidden="true" />
                {generating ? generatingLabel : report ? t.diagnose.aiReport.regenerateReport : t.diagnose.aiReport.generateReport}
              </Button>
              {report && (
                <Button variant="outline" onClick={doCopy}>
                  <Copy className="h-4 w-4" aria-hidden="true" /> {copyLabel === "copied" ? t.common.copied : t.common.copy}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setEditingKey(true)}>
                {t.diagnose.aiReport.changeKey}
              </Button>
            </div>
            {!hasAnyData && <p className="text-sm text-muted-foreground">{t.diagnose.aiReport.runScanFirst}</p>}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t.diagnose.aiReport.sendsDataNote}
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
            <p className="mb-2 font-mono text-xs text-muted-foreground">{t.diagnose.detailModal.generated(report.ts)}</p>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{report.md}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
