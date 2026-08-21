import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { dtcInfo, type DtcInfo } from "@/lib/dtc";
import type { DtcGroup } from "@/lib/dtc-grouping";
import { useT } from "@/i18n";

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

export function CodeGroupRow({
  group,
  affected,
  onSelect,
}: {
  group: DtcGroup;
  affected: ReadonlySet<string>;
  onSelect: (code: string) => void;
}) {
  const t = useT();
  const collapsesByDefault = group.codes.length > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!collapsesByDefault);
  const SEVERITY_LABEL: Record<DtcInfo["severity"] | "unknown", string> = {
    high: t.diagnose.groups.severity.high,
    medium: t.diagnose.groups.severity.medium,
    low: t.diagnose.groups.severity.low,
    unknown: t.diagnose.groups.severity.unknown,
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => collapsesByDefault && setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors",
          collapsesByDefault
            ? "cursor-pointer border border-border bg-muted/40 hover:border-primary/40 hover:bg-muted focus-visible:outline-2"
            : "cursor-default"
        )}
        aria-expanded={expanded}
        disabled={!collapsesByDefault}
      >
        {collapsesByDefault ? (
          // One icon that rotates, not two swapped icons — reads as "this
          // opens" rather than two unrelated static states. Boxed header +
          // hover border + trailing label (below): collapsed groups were
          // effectively invisible before this, easy to miss the codes
          // inside entirely (Alejandro, 2026-08-21).
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              expanded && "rotate-90"
            )}
            aria-hidden="true"
          />
        ) : (
          <span className={cn("h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[group.worstSeverity])} aria-hidden="true" />
        )}
        {/* group.system stays English in Phase 1 — sourced from
            decodeDtc() in lib/dtc.ts, same Phase 3 content boundary as
            the DTC library (see dictionary.ts's top comment). */}
        <span>{group.system}</span>
        <span className="text-muted-foreground">{t.diagnose.groups.codeCount(group.codes.length)}</span>
        {collapsesByDefault && (
          <span className="ml-auto shrink-0 text-xs font-normal text-primary">
            {expanded ? t.diagnose.groups.hideDetails : t.diagnose.groups.showDetails}
          </span>
        )}
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
                  aria-label={t.diagnose.detailsFor(code)}
                  title={SEVERITY_LABEL[severity]}
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[severity])} aria-hidden="true" />
                  <span className="font-mono">{code}</span>
                  {/* info?.title stays English in Phase 1 — DTC_LIBRARY
                      content, Phase 3. */}
                  <span className="truncate text-muted-foreground">{info?.title ?? t.diagnose.groups.notInLibrary}</span>
                  {affected.has(code) && (
                    <span
                      className="ml-auto shrink-0 text-xs text-muted-foreground"
                      title={t.diagnose.groups.voltageLinkedTooltip}
                    >
                      ⚡ {t.diagnose.groups.voltageLinked}
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
