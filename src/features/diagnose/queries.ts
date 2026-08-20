// TanStack Query hooks for the DTC/diagnose surface (Diagnose.tsx,
// WriteHistory.tsx). Every queryFn/mutationFn runs through DeviceService
// (effect-architecture plan.md phase 2); this file only moved from the old
// single lib/queries.ts in phase 4 - no behavior change.
import { Effect } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@/core/services/device-service";

const run = <A, E>(f: (device: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

// limit is hardcoded (never varies in the UI), so it stays out of the key —
// matches the key plan.md names verbatim: ["dtc_history"].
export function useDtcHistory() {
  return useQuery({
    queryKey: ["dtc_history"],
    queryFn: () => run((device) => device.dtcHistory(20)),
  });
}

// Bundles the best-effort `readiness` follow-up read the same way doScan
// always has — readiness never gets its own query key, it is a side read
// tied to the scan that just ran, not stable cacheable state.
export function useScanDtcs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      run((device) =>
        Effect.gen(function* () {
          const scan = yield* device.scanDtcs();
          // readiness is best-effort, same as before this migration.
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

// This is a write, not a read — the backend refuses without `confirmed:
// true` (write-caps' hard rule, src-tauri/src/lib.rs's require_confirmed),
// and it already does the verified before/after scan itself, returning
// ObdClearOutcome directly. DeviceService.clearDtcs always sends
// `confirmed: true` — this hook is only reachable from the ConfirmWrite
// modal's confirm action, never a bare button.
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

// The write audit trail (writes_log table) — every change this app has sent
// to the car, part 2 of the write-caps hard rule. useClearDtcs above
// invalidates this key, so the history card updates the moment a write
// actually lands.
export function useWritesLog(limit = 20) {
  return useQuery({
    queryKey: ["writes_log", limit],
    queryFn: () => run((device) => device.writesLog(limit)),
  });
}
