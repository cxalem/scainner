// Typed TanStack Query wrappers around every Tauri `invoke` read/write.
// Views never handwrite a query key or call `invoke` directly for cacheable
// server state — they call one of these hooks instead. Query keys start
// with the Tauri command name verbatim, then its args in call order
// (plan.md rule 2). Mutations invalidate the keys plan.md rule 4 names.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@/lib/tauri";
import type {
  CarReport,
  DtcResult,
  EcuInfo,
  DtcScanRow,
  HistoryPoint,
  SensorReading,
  UdsModule,
  UdsProbe,
} from "@/lib/meta";

// ---------- reads ----------

export function useReportCars() {
  return useQuery({
    queryKey: ["report_cars"],
    queryFn: () => invoke<[string, number][]>("report_cars"),
  });
}

// No placeholderData/keepPreviousData on purpose — a VIN change must drop to
// the skeleton, never show the previous car's report (plan.md rule 12).
export function useCarReport(vin: string | null) {
  return useQuery({
    queryKey: ["car_report", vin],
    queryFn: () => invoke<CarReport>("car_report", { vin }),
    enabled: vin != null,
  });
}

// limit is hardcoded (never varies in the UI), so it stays out of the key —
// matches the key plan.md names verbatim: ["dtc_history"].
export function useDtcHistory() {
  return useQuery({
    queryKey: ["dtc_history"],
    queryFn: () => invoke<DtcScanRow[]>("dtc_history", { limit: 20 }),
  });
}

export function useReadingKeys() {
  return useQuery({
    queryKey: ["reading_keys"],
    queryFn: () => invoke<string[]>("reading_keys"),
  });
}

export function useHistoryPoints(key: string, hours: number) {
  return useQuery({
    queryKey: ["history", key, hours],
    queryFn: () => invoke<HistoryPoint[]>("history", { key, sinceHours: hours }),
  });
}

export function useUdsModules() {
  return useQuery({
    queryKey: ["uds_modules"],
    queryFn: () => invoke<UdsModule[]>("uds_modules"),
  });
}

export function useCarInfo() {
  return useQuery({
    queryKey: ["car_info"],
    queryFn: () => invoke<[string, string][]>("car_info"),
  });
}

export function useDbPath() {
  return useQuery({
    queryKey: ["db_path"],
    queryFn: () => invoke<string>("db_path"),
  });
}

// enabled: false — Live's "Read all sensors" is a manual sweep, not a mount
// fetch (plan.md step 6). The button calls .refetch().
export function useAllSensors() {
  return useQuery({
    queryKey: ["all_sensors"],
    queryFn: () => invoke<SensorReading[]>("all_sensors"),
    enabled: false,
  });
}

// Not in plan.md's named key list (research flagged Lab's child cards as
// "not audited individually... flagged for the planner to size" — see
// decisions-build.md). Follows the same "command name verbatim" rule.
export function useListProbes() {
  return useQuery({
    queryKey: ["list_probes"],
    queryFn: () => invoke<UdsProbe[]>("list_probes"),
  });
}

// ---------- mutations ----------

export function useSetFuelPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { price: number }) => invoke<void>("set_fuel_price", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["car_report"] }),
  });
}

// Bundles the best-effort `readiness` follow-up read the same way doScan
// always has — readiness never gets its own query key, it is a side read
// tied to the scan that just ran, not stable cacheable state.
export function useScanDtcs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const scan = await invoke<DtcResult>("scan_dtcs");
      let readiness: Record<string, boolean> | null = null;
      try {
        readiness = await invoke<Record<string, boolean>>("readiness");
      } catch {
        // readiness is best-effort, same as before this migration
      }
      return { scan, readiness };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dtc_history"] });
      qc.invalidateQueries({ queryKey: ["car_report"] });
    },
  });
}

export function useClearDtcs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await invoke("clear_dtcs");
      // Verify: re-scan and return the outcome, same as before this
      // migration — Diagnose keeps its rescan-after-clear behavior.
      return invoke<DtcResult>("scan_dtcs");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dtc_history"] });
      qc.invalidateQueries({ queryKey: ["car_report"] });
    },
  });
}

export function useReadEcuInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<EcuInfo>("read_ecu_info"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["car_info"] }),
  });
}

export function useAddUdsModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { key: string; label: string; req: string; resp: string }) =>
      invoke<void>("add_uds_module", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["uds_modules"] }),
  });
}

export function useDeleteUdsModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { key: string }) => invoke<void>("delete_uds_module", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["uds_modules"] }),
  });
}

export function useAddProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { probe: UdsProbe }) => invoke<void>("add_probe", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["list_probes"] }),
  });
}

export function useToggleProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; enabled: boolean }) => invoke<void>("toggle_probe", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["list_probes"] }),
  });
}

export function useDeleteProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number }) => invoke<void>("delete_probe", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["list_probes"] }),
  });
}
