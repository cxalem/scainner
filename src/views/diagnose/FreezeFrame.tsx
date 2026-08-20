import { Snowflake } from "lucide-react";
import { GAUGES } from "@/shared/domain/gauges";

export function FreezeFrame({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([entryKey]) => entryKey !== "trigger_dtc");
  return (
    <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
      <p className="mb-2 flex items-center gap-1.5 font-medium">
        <Snowflake className="h-4 w-4" aria-hidden="true" /> Freeze frame
        {"trigger_dtc" in data && (
          <span className="font-mono text-xs text-muted-foreground">caused by {String(data.trigger_dtc)}</span>
        )}
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {entries.map(([entryKey, value]) => {
          const gauge = GAUGES.find((candidate) => candidate.key === entryKey);
          return (
            <div key={entryKey} className="flex justify-between gap-2">
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
