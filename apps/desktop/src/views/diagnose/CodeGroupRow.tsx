import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { dtcInfo, localizedSystem } from "@/lib/dtc";
import type { DtcGroup } from "@/lib/dtc-grouping";
import { useLocale, useT } from "@/i18n";

// A group auto-expands at or under this size; past it, it starts collapsed
// to a header with a count. See plan.md for why 6 (roughly a card's height
// before scrolling becomes worth avoiding) — at today's 2-3 code scans this
// never triggers, so the flat-list look is unchanged.
const COLLAPSE_THRESHOLD = 6;

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
  const { locale } = useLocale();
  const collapsesByDefault = group.codes.length > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!collapsesByDefault);

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
          // Neutral marker — the old severity-colored dot claimed a
          // judgment the app can't confirm (owner call, 2026-08-21).
          <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
        )}
        <span>{localizedSystem(group.system, locale)}</span>
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
            const info = dtcInfo(code, locale);
            return (
              <li key={code}>
                <button
                  type="button"
                  onClick={() => onSelect(code)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted focus-visible:outline-2"
                  aria-label={t.diagnose.detailsFor(code)}
                >
                  <span className="font-mono">{code}</span>
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
