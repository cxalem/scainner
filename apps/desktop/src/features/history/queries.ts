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
