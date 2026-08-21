import { Snowflake } from "lucide-react";
import { GAUGES } from "@/shared/domain/gauges";
import { useT } from "@/i18n";

export function FreezeFrame({ data }: { data: Record<string, unknown> }) {
  const t = useT();
  const entries = Object.entries(data).filter(([entryKey]) => entryKey !== "trigger_dtc");
  return (
    <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
      <p className="mb-2 flex items-center gap-1.5 font-medium">
        <Snowflake className="h-4 w-4" aria-hidden="true" /> {t.diagnose.freezeFrame.title}
        {"trigger_dtc" in data && (
          <span className="font-mono text-xs text-muted-foreground">
            {t.diagnose.freezeFrame.causedBy(String(data.trigger_dtc))}
          </span>
        )}
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {entries.map(([entryKey, value]) => {
          const gauge = GAUGES.find((candidate) => candidate.key === entryKey);
          return (
            <div key={entryKey} className="flex justify-between gap-2">
              {/* gauge.label stays English in Phase 1 — shared/domain/
                  gauges.ts content, same Phase 3 boundary. */}
              <span className="text-muted-foreground">{gauge?.label ?? entryKey}</span>
              <span className="font-mono">
                {typeof value === "number" ? (gauge?.fmt ? gauge.fmt(value) : value) : String(value)} {gauge?.unit ?? ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
