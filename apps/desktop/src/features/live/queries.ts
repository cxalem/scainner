import { Effect } from "effect";
import { useQuery } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";

const run = <A, E>(f: (device: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

export function useAllSensors() {
  return useQuery({
    queryKey: ["all_sensors"],
    queryFn: () => run((device) => device.allSensors()),
    enabled: false,
  });
}
