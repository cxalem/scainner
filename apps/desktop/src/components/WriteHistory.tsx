import { PenLine } from "lucide-react";
import { Button, Card, CardHead, Mono, Note, Pill, Skeleton } from "@/components/ui";
import { useWritesLog } from "@/features/diagnose/queries";
import type { WriteLogRow } from "@scainner/core";
import { useT, type Dictionary } from "@/i18n";

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

function summary(w: WriteLogRow, t: Dictionary): string {
  const before = codeCount(w.before);
  const after = codeCount(w.after);
  if (w.outcome === "error") {
    return w.error ? t.diagnose.writeHistory.failedWith(w.error) : t.diagnose.writeHistory.failed;
  }
  if (before == null) return "";
  if (after == null) return t.diagnose.writeHistory.codesBeforeUnread(before);
  return t.diagnose.writeHistory.codesBeforeAfter(before, after);
}

export function WriteHistory({ vehicleId }: { vehicleId: number | null }) {
  const t = useT();
  const { data: rows = [], isPending, isError, refetch } = useWritesLog(vehicleId);

  const outcomePill: Record<WriteLogRow["outcome"], { label: string; variant: "ok" | "warn" | "stop" }> = {
    cleared: { label: t.diagnose.writeHistory.outcome.cleared, variant: "ok" },
    faults_remain: { label: t.diagnose.writeHistory.outcome.faultsRemain, variant: "warn" },
    refused: { label: t.diagnose.writeHistory.outcome.refused, variant: "warn" },
    error: { label: t.diagnose.writeHistory.outcome.failed, variant: "stop" },
  };
  const actionLabels: Record<string, string> = {
    clear_dtcs: t.diagnose.writeHistory.action.clearDtcs,
    clear_faults: t.diagnose.writeHistory.action.clearDtcs,
  };

  return (
    <Card className="gap-2">
      <CardHead icon={PenLine} title={t.diagnose.writeHistory.cardTitle} />
      {isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 text-[12.5px] text-stop">
          <span>{t.diagnose.writeHistory.couldNotLoad}</span>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            {t.common.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Note>{t.diagnose.writeHistory.noWritesYet}</Note>
      ) : (
        <ul className="flex flex-col">
          {rows.map((w) => {
            const pill = outcomePill[w.outcome] ?? { label: w.outcome, variant: "warn" as const };
            const rowSummary = summary(w, t);
            return (
              <li key={w.id} className="flex items-center justify-between gap-3 border-b border-neutral-900 py-2 last:border-0">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[12.5px]">
                    {actionLabels[w.action] ?? w.action} · <span className="text-neutral-500">{w.module}</span>
                  </span>
                  <Mono className="truncate text-[11.5px] text-neutral-500">
                    {w.ts} UTC{rowSummary ? ` · ${rowSummary}` : ""}
                  </Mono>
                </span>
                <Pill variant={pill.variant}>{pill.label}</Pill>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
