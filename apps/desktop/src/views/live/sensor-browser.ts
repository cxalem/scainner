import type { ReadingKey } from "@scainner/core";

export type SensorRow = {
  key: string;
  label: string;
  unit: string;
  group: string;
  inRange: boolean;
  lastTs: string | null;
};

export type SensorGroup = {
  name: string;
  rows: SensorRow[];
  total: number;
};

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
  query: string;
  rangeHours: number;
  now: number;
  showAll: boolean;
  keepKey?: string | null;
  labelOf: (entry: ReadingKey) => string;
  unitOf: (entry: ReadingKey) => string;
  standardGroupName: string;
};

export type SensorGroups = {
  groups: SensorGroup[];
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

export function flattenKeys(groups: readonly SensorGroup[], collapsed: ReadonlySet<string>): string[] {
  return groups.filter((g) => !collapsed.has(g.name)).flatMap((g) => g.rows.map((r) => r.key));
}

export function stepKey(keys: readonly string[], current: string, delta: 1 | -1): string | null {
  if (keys.length === 0) return null;
  const at = keys.indexOf(current);
  if (at === -1) return keys[delta === 1 ? 0 : keys.length - 1];
  const next = at + delta;
  return next < 0 || next >= keys.length ? null : keys[next];
}
