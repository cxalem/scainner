export type Reading = { ts: string; key: string; value: number };

type Stats = {
  min: number;
  max: number;
  avg: number;
  count: number;
  first: number;
  last: number;
};

export function aggregateReadings(readings: Reading[], channelLimit = 12) {
  const byKey = new Map<string, Reading[]>();
  for (const reading of readings) {
    const values = byKey.get(reading.key) ?? [];
    values.push(reading);
    byKey.set(reading.key, values);
  }
  const ranked = [...byKey.entries()].sort((a, b) => b[1].length - a[1].length);
  const channels: Record<
    string,
    {
      stats: Stats;
      minute_bins: Array<
        { minute: string; min: number; avg: number; max: number; count: number }
      >;
    }
  > = {};
  for (const [key, values] of ranked.slice(0, channelLimit)) {
    values.sort((a, b) => a.ts.localeCompare(b.ts));
    const stats = summarize(values.map((entry) => entry.value));
    const bins = new Map<string, number[]>();
    for (const entry of values) {
      const minute = entry.ts.slice(0, 16);
      const bucket = bins.get(minute) ?? [];
      bucket.push(entry.value);
      bins.set(minute, bucket);
    }
    channels[key] = {
      stats: { ...stats, first: values[0].value, last: values.at(-1)!.value },
      minute_bins: [...bins].map(([minute, bucket]) => ({
        minute,
        ...summarize(bucket),
      })),
    };
  }
  return {
    reading_count: readings.length,
    channel_count: byKey.size,
    channels,
  };
}

function summarize(values: number[]) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  return {
    min,
    max,
    avg: values.length ? sum / values.length : 0,
    count: values.length,
  };
}
