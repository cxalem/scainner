import { PenLine } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { useWritesLog } from "@/lib/queries";
import type { WriteLogRow } from "@/lib/meta";

// The visible half of the write audit trail (writes_log table): every change
// this app has sent to the car, with what was there before and after. Part 2
// of the write-caps hard rule. useClearDtcs and ModuleFaults' clear() both
// invalidate the writes_log query key, so this stays current on its own,
// no manual refresh prop needed.

const OUTCOME_BADGE: Record<WriteLogRow["outcome"], { label: string; variant: "ok" | "warn" | "error" }> = {
  cleared: { label: "cleared", variant: "ok" },
  faults_remain: { label: "faults remain", variant: "warn" },
  refused: { label: "module refused", variant: "warn" },
  error: { label: "failed", variant: "error" },
};

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

function summary(w: WriteLogRow): string {
  const before = codeCount(w.before);
  const after = codeCount(w.after);
  if (w.outcome === "error") {
    return w.error ? `failed: ${w.error}` : "failed";
  }
  if (before == null) return "";
  if (after == null) return `${before} code${before === 1 ? "" : "s"} before, result not read`;
  return `${before} code${before === 1 ? "" : "s"} before, ${after} after`;
}

const ACTION_LABELS: Record<string, string> = {
  clear_dtcs: "Fault code clear",
  clear_faults: "Fault code clear",
};

export function WriteHistory() {
  const { data: rows = [], isPending, isError, refetch } = useWritesLog();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <PenLine className="h-4 w-4" aria-hidden="true" /> Write history
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
            <span>Could not load write history.</span>
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No writes recorded yet. Every change this app sends to the car is listed here, with the state read
            before and after.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {rows.map((w) => {
              const badge = OUTCOME_BADGE[w.outcome] ?? { label: w.outcome, variant: "warn" as const };
              return (
                <li key={w.id} className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-0">
                  <span className="min-w-0">
                    <span className="block truncate">
                      {ACTION_LABELS[w.action] ?? w.action} · <span className="text-muted-foreground">{w.module}</span>
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {w.ts} UTC{summary(w) ? ` · ${summary(w)}` : ""}
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
