// The Over-time sensor browser's list logic, kept pure so it can be tested
// without a DOM: turn the enriched reading keys into filtered, grouped,
// sorted rows and say how many the "show all" toggle is holding back.
//
// Nothing here knows about React or i18n — labels, units and the name of
// the standard group are supplied by the caller (views/live/SensorBrowser).
import type { ReadingKey } from "@scainner/core";

export type SensorRow = {
  key: string;
  label: string;
  unit: string;
  /// The group this row belongs to (the module name, or the standard group).
  group: string;
  /// The key has at least one reading inside the selected range.
  inRange: boolean;
  lastTs: string | null;
};

export type SensorGroup = {
  name: string;
  /// Rows to render, already sorted.
  rows: SensorRow[];
  /// Every row that matched the search in this group, including the ones the
  /// "show all" toggle is hiding — this is the count shown beside the name.
  total: number;
};

/// SQLite writes `datetime('now')` as "YYYY-MM-DD HH:MM:SS" in UTC. Date
/// parsing of that literal is implementation-defined, so spell out the zone.
export function parseReadingTs(ts: string | null): number | null {
  if (!ts) return null;
  const parsed = Date.parse(`${ts.trim().replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

export function isInRange(lastTs: string | null, rangeHours: number, now: number): boolean {
  const at = parseReadingTs(lastTs);
  return at !== null && now - at <= rangeHours * 3_600_000;
}

export type GroupOptions = {
  /// Free-text search over label, key and group name.
  query: string;
  rangeHours: number;
  now: number;
  /// False hides rows with no readings in the range behind the toggle.
  showAll: boolean;
  /// Never hidden, whatever its timestamp says — the chart is showing it.
  keepKey?: string | null;
  labelOf: (entry: ReadingKey) => string;
  unitOf: (entry: ReadingKey) => string;
  standardGroupName: string;
};

export type SensorGroups = {
  groups: SensorGroup[];
  /// Rows matching the search that the toggle is hiding.
  hiddenCount: number;
};

export function toSensorRow(entry: ReadingKey, options: GroupOptions): SensorRow {
  return {
    key: entry.key,
    label: options.labelOf(entry),
    unit: options.unitOf(entry),
    group: entry.source === "standard" ? options.standardGroupName : (entry.module_name ?? entry.module_key ?? options.standardGroupName),
    inRange: isInRange(entry.last_ts, options.rangeHours, options.now),
    lastTs: entry.last_ts,
  };
}

function matches(row: SensorRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return row.label.toLowerCase().includes(q) || row.key.toLowerCase().includes(q) || row.group.toLowerCase().includes(q);
}

/// Groups in reading order: the standard group first, then module groups by
/// name. Inside a group, keys with data in the range come first, then
/// alphabetically by label.
export function buildSensorGroups(keys: readonly ReadingKey[], options: GroupOptions): SensorGroups {
  const query = options.query.trim();
  const rows = keys.map((entry) => toSensorRow(entry, options)).filter((row) => matches(row, query));

  const byGroup = new Map<string, SensorRow[]>();
  for (const row of rows) {
    const bucket = byGroup.get(row.group);
    if (bucket) bucket.push(row);
    else byGroup.set(row.group, [row]);
  }

  let hiddenCount = 0;
  const groups: SensorGroup[] = [];
  for (const [name, groupRows] of byGroup) {
    const sorted = [...groupRows].sort(
      (a, b) => Number(b.inRange) - Number(a.inRange) || a.label.localeCompare(b.label),
    );
    const visible = options.showAll ? sorted : sorted.filter((row) => row.inRange || row.key === options.keepKey);
    hiddenCount += sorted.length - visible.length;
    if (visible.length > 0) groups.push({ name, rows: visible, total: sorted.length });
  }

  groups.sort((a, b) => {
    if (a.name === options.standardGroupName) return -1;
    if (b.name === options.standardGroupName) return 1;
    return a.name.localeCompare(b.name);
  });

  return { groups, hiddenCount };
}

/// The keys of every rendered row, in the order they appear — what the
/// up/down arrows walk.
export function flattenKeys(groups: readonly SensorGroup[], collapsed: ReadonlySet<string>): string[] {
  return groups.filter((g) => !collapsed.has(g.name)).flatMap((g) => g.rows.map((r) => r.key));
}

/// The next key up or down from `current`, clamped at both ends. Returns
/// null when there is nothing to move to.
export function stepKey(keys: readonly string[], current: string, delta: 1 | -1): string | null {
  if (keys.length === 0) return null;
  const at = keys.indexOf(current);
  if (at === -1) return keys[delta === 1 ? 0 : keys.length - 1];
  const next = at + delta;
  return next < 0 || next >= keys.length ? null : keys[next];
}
