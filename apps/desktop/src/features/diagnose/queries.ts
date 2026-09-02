import { Effect } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";

const run = <A, E>(f: (device: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

export function useDtcHistory(vehicleId: number | null) {
  return useQuery({
    queryKey: ["dtc_history", vehicleId],
    queryFn: () => run((device) => device.dtcHistory(vehicleId, 20)),
  });
}

export function useScanDtcs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      run((device) =>
        Effect.gen(function* () {
          const scan = yield* device.scanDtcs();
          const readiness = yield* device.readiness().pipe(Effect.catchAll(() => Effect.succeed(null)));
          return { scan, readiness };
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dtc_history"] });
      qc.invalidateQueries({ queryKey: ["car_report"] });
    },
  });
}

export function useClearDtcs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => run((device) => device.clearDtcs()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dtc_history"] });
      qc.invalidateQueries({ queryKey: ["car_report"] });
      qc.invalidateQueries({ queryKey: ["writes_log"] });
    },
  });
}

export function useWritesLog(vehicleId: number | null, limit = 20) {
  return useQuery({
    queryKey: ["writes_log", vehicleId, limit],
    queryFn: () => run((device) => device.writesLog(vehicleId, limit)),
  });
}
