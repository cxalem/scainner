import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { ReadingKey } from "@scainner/core";
import { Button, Dot, Input, Note, Select, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { buildSensorGroups, flattenKeys, stepKey, type SensorGroup } from "@/views/live/sensor-browser";

type BrowserProps = {
  keys: readonly ReadingKey[];
  selected: string;
  onSelect: (key: string) => void;
  rangeHours: number;
  labelOf: (entry: ReadingKey) => string;
  unitOf: (entry: ReadingKey) => string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

function useGroups(props: BrowserProps, query: string, showAll: boolean) {
  const t = useT();
  return useMemo(
    () =>
      buildSensorGroups(props.keys, {
        query,
        rangeHours: props.rangeHours,
        now: Date.now(),
        showAll,
        keepKey: props.selected,
        labelOf: props.labelOf,
        unitOf: props.unitOf,
        standardGroupName: t.history.trend.browser.standard,
      }),
    [props.keys, props.rangeHours, props.selected, props.labelOf, props.unitOf, query, showAll, t],
  );
}

function GroupHeader({ group, open, onToggle }: { group: SensorGroup; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-1.5 px-2 py-[7px] text-left text-[11.5px] text-neutral-500",
        "transition-colors duration-150 hover:text-text",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      )}
    >
      <ChevronDown
        className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none", !open && "-rotate-90")}
        aria-hidden="true"
      />
      <span className="flex-1 truncate">{group.name}</span>
      <span className="num text-[11px] text-neutral-600">{group.total}</span>
    </button>
  );
}

export function SensorBrowser(props: BrowserProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const { groups, hiddenCount } = useGroups(props, query, showAll);
  const walkable = useMemo(() => flattenKeys(groups, collapsed), [groups, collapsed]);
  const focusKey = walkable.includes(props.selected) ? props.selected : walkable[0];

  useEffect(() => {
    if (query.trim()) setCollapsed(new Set());
  }, [query]);

  const move = (delta: 1 | -1) => {
    const next = stepKey(walkable, props.selected, delta);
    if (!next) return;
    props.onSelect(next);
    rowRefs.current.get(next)?.focus();
  };

  const toggleGroup = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const body = () => {
    if (props.loading) {
      return (
        <div className="flex flex-col gap-1.5 p-2" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      );
    }
    if (props.error) {
      return (
        <div className="flex flex-col items-start gap-2 p-3">
          <Note className="text-stop">{t.history.trend.browser.couldNotLoad}</Note>
          <Button size="sm" onClick={props.onRetry}>
            {t.common.retry}
          </Button>
        </div>
      );
    }
    if (props.keys.length === 0) {
      return <Note className="p-3">{t.history.trend.browser.empty}</Note>;
    }
    if (groups.length === 0) {
      return <Note className="p-3">{t.history.trend.browser.noMatch(query.trim())}</Note>;
    }
    return (
      <div className="flex flex-col py-1" onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        move(e.key === "ArrowDown" ? 1 : -1);
      }}>
        {groups.map((group) => {
          const open = !collapsed.has(group.name);
          return (
            <div key={group.name} className="flex flex-col">
              <GroupHeader group={group} open={open} onToggle={() => toggleGroup(group.name)} />
              {open &&
                group.rows.map((row) => {
                  const active = row.key === props.selected;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      ref={(el) => {
                        if (el) rowRefs.current.set(row.key, el);
                        else rowRefs.current.delete(row.key);
                      }}
                      aria-current={active ? "true" : undefined}
                      tabIndex={row.key === focusKey ? 0 : -1}
                      title={row.inRange ? undefined : t.history.trend.browser.noDataInRange}
                      onClick={() => props.onSelect(row.key)}
                      className={cn(
                        "flex min-h-9 items-center gap-2 rounded-sm py-1.5 pl-[26px] pr-2 text-left text-[12.5px]",
                        "transition-colors duration-150 motion-reduce:transition-none",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        active ? "bg-accent-900 text-text" : "text-neutral-400 hover:bg-bg hover:text-text",
                      )}
                    >
                      <span className="flex-1 truncate">{row.label}</span>
                      {row.unit && <span className="shrink-0 text-[11px] text-neutral-600">{row.unit}</span>}
                      {row.inRange ? (
                        <Dot tone="accent" className="shrink-0" />
                      ) : (
                        <span className="h-1.5 w-1.5 shrink-0" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md bg-surface shadow-sm">
      <div className="relative border-b border-divider p-2">
        <Search className="pointer-events-none absolute left-[18px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-600" aria-hidden="true" />
        <Input
          type="search"
          aria-label={t.history.trend.browser.searchAriaLabel}
          placeholder={t.history.trend.browser.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-9 py-[5px] pl-8 text-[12.5px]"
        />
      </div>
      <div role="group" aria-label={t.history.trend.browser.listAriaLabel} className="min-h-0 flex-1 overflow-y-auto">
        {body()}
      </div>
      {(hiddenCount > 0 || showAll) && !props.loading && !props.error && (
        <div className="border-t border-divider px-2 py-1.5">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className={cn(
              "w-full rounded-sm px-1 py-1 text-left text-[11.5px] text-neutral-500",
              "transition-colors duration-150 hover:text-accent-400",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            )}
          >
            {showAll ? t.history.trend.browser.showFewer : t.history.trend.browser.showAll(hiddenCount)}
          </button>
        </div>
      )}
    </div>
  );
}

export function SensorSelect(props: BrowserProps) {
  const t = useT();
  const { groups } = useGroups(props, "", true);
  const id = "trend-sensor-select";
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11.5px] text-neutral-500">
        {t.history.trend.browser.pickerLabel}
      </label>
      <Select id={id} value={props.selected} onChange={(e) => props.onSelect(e.target.value)} disabled={props.loading || props.error}>
        {!groups.some((g) => g.rows.some((r) => r.key === props.selected)) && (
          <option value={props.selected}>{props.selected}</option>
        )}
        {groups.map((group) => (
          <optgroup key={group.name} label={group.name}>
            {group.rows.map((row) => (
              <option key={row.key} value={row.key}>
                {row.unit ? `${row.label} · ${row.unit}` : row.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  );
}
