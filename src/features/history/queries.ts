// TanStack Query hooks for History.tsx's time-series surface. Every
// queryFn runs through DeviceService (effect-architecture plan.md phase 2);
// this file only moved from the old single lib/queries.ts in phase 4 - no
// behavior change.
import { Effect } from "effect";
import { useQuery } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@/core/services/device-service";

const run = <A, E>(f: (s: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

export function useReadingKeys() {
  return useQuery({
    queryKey: ["reading_keys"],
    queryFn: () => run((s) => s.readingKeys()),
  });
}

export function useHistoryPoints(key: string, hours: number) {
  return useQuery({
    queryKey: ["history", key, hours],
    queryFn: () => run((s) => s.historyPoints(key, hours)),
  });
}
