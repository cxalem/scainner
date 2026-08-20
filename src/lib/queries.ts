// Typed TanStack Query wrappers around every Tauri `invoke` read/write.
// Views never handwrite a query key or call `invoke` directly for cacheable
// server state — they call one of these hooks instead. Query keys start
// with the Tauri command name verbatim, then its args in call order
// (plan.md rule 2). Mutations invalidate the keys plan.md rule 4 names.
//
// Every queryFn/mutationFn body below runs through DeviceService (the
// Effect+Schema+Layer pattern, effect-architecture plan.md phase 2) instead
// of calling `invoke` directly. Hook shapes (queryKey, enabled,
// invalidation) are unchanged from before the migration.
import { Effect } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@/core/services/device-service";
import type { UdsProbe } from "@/lib/meta";

const run = <A, E>(f: (s: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

// ---------- reads ----------

export function useReportCars() {
  return useQuery({
    queryKey: ["report_cars"],
    queryFn: () => run((s) => s.reportCars()),
  });
}

// No placeholderData/keepPreviousData on purpose — a VIN change must drop to
// the skeleton, never show the previous car's report (plan.md rule 12).
export function useCarReport(vin: string | null) {
  return useQuery({
    queryKey: ["car_report", vin],
    queryFn: () => run((s) => s.carReport(vin!)),
    enabled: vin != null,
  });
}

// limit is hardcoded (never varies in the UI), so it stays out of the key —
// matches the key plan.md names verbatim: ["dtc_history"].
export function useDtcHistory() {
  return useQuery({
    queryKey: ["dtc_history"],
    queryFn: () => run((s) => s.dtcHistory(20)),
  });
}

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

export function useUdsModules() {
  return useQuery({
    queryKey: ["uds_modules"],
    queryFn: () => run((s) => s.udsModules()),
  });
}

export function useCarInfo() {
  return useQuery({
    queryKey: ["car_info"],
    queryFn: () => run((s) => s.carInfo()),
  });
}

export function useDbPath() {
  return useQuery({
    queryKey: ["db_path"],
    queryFn: () => run((s) => s.dbPath()),
  });
}

// enabled: false — Live's "Read all sensors" is a manual sweep, not a mount
// fetch (plan.md step 6). The button calls .refetch().
export function useAllSensors() {
  return useQuery({
    queryKey: ["all_sensors"],
    queryFn: () => run((s) => s.allSensors()),
    enabled: false,
  });
}

// Not in plan.md's named key list (research flagged Lab's child cards as
// "not audited individually... flagged for the planner to size" — see
// decisions-build.md). Follows the same "command name verbatim" rule.
export function useListProbes() {
  return useQuery({
    queryKey: ["list_probes"],
    queryFn: () => run((s) => s.listProbes()),
  });
}

// ---------- mutations ----------

export function useSetFuelPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { price: number }) => run((s) => s.setFuelPrice(vars.price)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["car_report"] }),
  });
}

// Bundles the best-effort `readiness` follow-up read the same way doScan
// always has — readiness never gets its own query key, it is a side read
// tied to the scan that just ran, not stable cacheable state.
export function useScanDtcs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      run((s) =>
        Effect.gen(function* () {
          const scan = yield* s.scanDtcs();
          // readiness is best-effort, same as before this migration.
          const readiness = yield* s.readiness().pipe(Effect.catchAll(() => Effect.succeed(null)));
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
    mutationFn: () => run((s) => s.clearDtcs()),
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
    queryFn: () => run((s) => s.writesLog(limit)),
  });
}

export function useReadEcuInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => run((s) => s.readEcuInfo()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["car_info"] }),
  });
}

export function useAddUdsModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { key: string; label: string; req: string; resp: string }) =>
      run((s) => s.addUdsModule(vars)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["uds_modules"] }),
  });
}

export function useDeleteUdsModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { key: string }) => run((s) => s.deleteUdsModule(vars.key)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["uds_modules"] }),
  });
}

export function useAddProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { probe: UdsProbe }) => run((s) => s.addProbe(vars.probe)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["list_probes"] }),
  });
}

export function useToggleProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; enabled: boolean }) => run((s) => s.toggleProbe(vars.id, vars.enabled)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["list_probes"] }),
  });
}

export function useDeleteProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number }) => run((s) => s.deleteProbe(vars.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["list_probes"] }),
  });
}
