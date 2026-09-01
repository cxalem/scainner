// TanStack Query hooks for History.tsx's time-series surface. Every
// queryFn runs through DeviceService (effect-architecture plan.md phase 2);
// this file only moved from the old single lib/queries.ts in phase 4 - no
// behavior change.
import { Effect } from "effect";
import { useQuery } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";

const run = <A, E>(f: (device: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

export function useReadingKeys(vehicleId: number | null) {
  return useQuery({
    queryKey: ["reading_keys", vehicleId],
    queryFn: () => run((device) => device.readingKeys(vehicleId)),
  });
}

/// The enriched key list behind the Over-time sensor browser: label, unit,
/// module and the newest timestamp per key. Stale for a minute — the list
/// only changes when a probe is added or a new key is first recorded.
export function useReadingKeyDetails(vehicleId: number | null) {
  return useQuery({
    queryKey: ["reading_key_details", vehicleId],
    queryFn: () => run((device) => device.readingKeyDetails(vehicleId)),
    staleTime: 60_000,
  });
}

export function useHistoryPoints(vehicleId: number | null, key: string, hours: number) {
  return useQuery({
    queryKey: ["history", vehicleId, key, hours],
    queryFn: () => run((device) => device.historyPoints(vehicleId, key, hours)),
  });
}
