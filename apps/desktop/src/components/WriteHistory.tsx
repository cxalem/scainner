import { PenLine } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { useWritesLog } from "@/features/diagnose/queries";
import type { WriteLogRow } from "@scainner/core";
import { useT, type Dictionary } from "@/i18n";

// The visible half of the write audit trail (writes_log table): every change
// this app has sent to the car, with what was there before and after. Part 2
// of the write-caps hard rule. useClearDtcs and ModuleFaults' clear() both
// invalidate the writes_log query key, so this stays current on its own,
// no manual refresh prop needed.

// Both current write actions clear fault codes; their before/after states
// are either a plain code list (module clear) or an object with stored and
// pending lists (engine clear). Count what is countable, admit when not.
function codeCount(state: unknown): number | null {
  if (Array.isArray(state)) return state.length;
  if (state && typeof state === "object") {
    const s = state as Record<string, unknown>;
    if (Array.isArray(s.stored) || Array.isArray(s.pending)) {
      return ((s.stored as unknown[]) ?? []).length + ((s.pending as unknown[]) ?? []).length;
    }
  }
  return null;
}

// Takes `t` as a parameter (not a hook) — this is a plain function, not a
// component, so it can't call useT() itself; the one call site below reads
// the current dictionary once and passes it through.
function summary(w: WriteLogRow, t: Dictionary): string {
  const before = codeCount(w.before);
  const after = codeCount(w.after);
  if (w.outcome === "error") {
    // w.error is a raw backend string — untranslated in Phase 1, see
    // docs/workflows/i18n/plan.md's Phase 5 (Rust/backend strings).
    return w.error ? t.diagnose.writeHistory.failedWith(w.error) : t.diagnose.writeHistory.failed;
  }
  if (before == null) return "";
  if (after == null) return t.diagnose.writeHistory.codesBeforeUnread(before);
  return t.diagnose.writeHistory.codesBeforeAfter(before, after);
}

export function WriteHistory({ vehicleId }: { vehicleId: number | null }) {
  const t = useT();
  const { data: rows = [], isPending, isError, refetch } = useWritesLog(vehicleId);

  const outcomeBadge: Record<WriteLogRow["outcome"], { label: string; variant: "ok" | "warn" | "error" }> = {
    cleared: { label: t.diagnose.writeHistory.outcome.cleared, variant: "ok" },
    faults_remain: { label: t.diagnose.writeHistory.outcome.faultsRemain, variant: "warn" },
    refused: { label: t.diagnose.writeHistory.outcome.refused, variant: "warn" },
    error: { label: t.diagnose.writeHistory.outcome.failed, variant: "error" },
  };
  // action_labels keys are the backend's own action identifiers
  // ("clear_dtcs"/"clear_faults") — both map to the same translated label.
  const actionLabels: Record<string, string> = {
    clear_dtcs: t.diagnose.writeHistory.action.clearDtcs,
    clear_faults: t.diagnose.writeHistory.action.clearDtcs,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <PenLine className="h-4 w-4" aria-hidden="true" /> {t.diagnose.writeHistory.cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <span>{t.diagnose.writeHistory.couldNotLoad}</span>
            <Button variant="outline" onClick={() => refetch()}>
              {t.common.retry}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.diagnose.writeHistory.noWritesYet}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {rows.map((w) => {
              const badge = outcomeBadge[w.outcome] ?? { label: w.outcome, variant: "warn" as const };
              const rowSummary = summary(w, t);
              return (
                <li key={w.id} className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-0">
                  <span className="min-w-0">
                    <span className="block truncate">
                      {actionLabels[w.action] ?? w.action} · <span className="text-muted-foreground">{w.module}</span>
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {w.ts} UTC{rowSummary ? ` · ${rowSummary}` : ""}
                    </span>
                  </span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
