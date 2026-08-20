// TanStack Query hook for Live.tsx's manual full-sensor sweep. Runs through
// DeviceService (effect-architecture plan.md phase 2); this file only moved
// from the old single lib/queries.ts in phase 4 - no behavior change.
import { Effect } from "effect";
import { useQuery } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@/core/services/device-service";

const run = <A, E>(f: (device: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

// enabled: false — Live's "Read all sensors" is a manual sweep, not a mount
// fetch (plan.md step 6). The button calls .refetch().
export function useAllSensors() {
  return useQuery({
    queryKey: ["all_sensors"],
    queryFn: () => run((device) => device.allSensors()),
    enabled: false,
  });
}
