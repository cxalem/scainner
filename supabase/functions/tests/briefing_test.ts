import { assertEquals } from "jsr:@std/assert@1";
import { aggregateReadings } from "../_shared/briefing.ts";

Deno.test("briefing aggregation computes channel statistics and minute bins", () => {
  const result = aggregateReadings([
    { ts: "2026-09-02T10:00:01Z", key: "rpm", value: 800 },
    { ts: "2026-09-02T10:00:31Z", key: "rpm", value: 1000 },
    { ts: "2026-09-02T10:01:01Z", key: "rpm", value: 1200 },
  ]);
  assertEquals(result.reading_count, 3);
  assertEquals(result.channels.rpm.stats, {
    min: 800,
    max: 1200,
    avg: 1000,
    count: 3,
    first: 800,
    last: 1200,
  });
  assertEquals(result.channels.rpm.minute_bins.length, 2);
});
