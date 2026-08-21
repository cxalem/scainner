import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { dtcInfo, type DtcInfo } from "@/lib/dtc";
import type { DtcGroup } from "@/lib/dtc-grouping";

// A group auto-expands at or under this size; past it, it starts collapsed
// to a header with a count. See plan.md for why 6 (roughly a card's height
// before scrolling becomes worth avoiding) — at today's 2-3 code scans this
// never triggers, so the flat-list look is unchanged.
const COLLAPSE_THRESHOLD = 6;

const SEVERITY_DOT: Record<DtcInfo["severity"] | "unknown", string> = {
  high: "bg-destructive",
  medium: "bg-warn",
  low: "bg-primary",
  unknown: "bg-muted-foreground",
};

const SEVERITY_LABEL: Record<DtcInfo["severity"] | "unknown", string> = {
  high: "High severity",
  medium: "Medium severity",
  low: "Low severity",
  unknown: "Not in the offline library",
};

export function CodeGroupRow({
  group,
  affected,
  onSelect,
}: {
  group: DtcGroup;
  affected: ReadonlySet<string>;
  onSelect: (code: string) => void;
}) {
  const collapsesByDefault = group.codes.length > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!collapsesByDefault);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => collapsesByDefault && setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 text-left text-sm font-medium",
          collapsesByDefault ? "cursor-pointer hover:text-foreground" : "cursor-default"
        )}
        aria-expanded={expanded}
        disabled={!collapsesByDefault}
      >
        {collapsesByDefault ? (
          expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )
        ) : (
          <span className={cn("h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[group.worstSeverity])} aria-hidden="true" />
        )}
        <span>{group.system}</span>
        <span className="text-muted-foreground">
          ({group.codes.length} code{group.codes.length === 1 ? "" : "s"})
        </span>
      </button>

      {expanded && (
        <ul className="ml-5 flex flex-col gap-1">
          {group.codes.map((code) => {
            const info = dtcInfo(code);
            const severity = info?.severity ?? "unknown";
            return (
              <li key={code}>
                <button
                  type="button"
                  onClick={() => onSelect(code)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted focus-visible:outline-2"
                  aria-label={`Details for ${code}`}
                  title={SEVERITY_LABEL[severity]}
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[severity])} aria-hidden="true" />
                  <span className="font-mono">{code}</span>
                  <span className="truncate text-muted-foreground">{info?.title ?? "Not in the offline library"}</span>
                  {affected.has(code) && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground" title="Likely a voltage side effect — see the note above">
                      ⚡ voltage-linked
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
