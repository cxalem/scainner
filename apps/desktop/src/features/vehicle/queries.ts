import { Effect } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { resetSyncWatermark } from "@/lib/sync";

const run = <A, E>(f: (device: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

export function useVehicles() {
  return useQuery({
    queryKey: ["list_vehicles"],
    queryFn: () => run((device) => device.listVehicles()),
  });
}

export function useVehicleReport(vehicleId: number | null) {
  return useQuery({
    queryKey: ["vehicle_report", vehicleId],
    queryFn: () => run((device) => device.vehicleReport(vehicleId!)),
    enabled: vehicleId != null,
  });
}

export function useVehicleInfo(vehicleId: number | null) {
  return useQuery({
    queryKey: ["vehicle_info", vehicleId],
    queryFn: () => run((device) => device.vehicleInfo(vehicleId!)),
    enabled: vehicleId != null,
  });
}

export function useVehicleEvidenceMap(vehicleId: number | null) {
  return useQuery({
    queryKey: ["vehicle_evidence_map", vehicleId],
    queryFn: () => run((device) => device.vehicleEvidenceMap(vehicleId!)),
    enabled: vehicleId != null,
  });
}

export function useDbPath() {
  return useQuery({
    queryKey: ["db_path"],
    queryFn: () => run((device) => device.dbPath()),
  });
}

export function useSetFuelPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { vehicleId: number; price: number }) =>
      run((device) => device.setFuelPrice(vars.vehicleId, vars.price)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicle_report"] }),
  });
}

export function useNameCurrentVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string }) => run((device) => device.nameCurrentVehicle(vars.name)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["list_vehicles"] });
      void qc.invalidateQueries({ queryKey: ["vehicle_report"] });
      void qc.invalidateQueries({ queryKey: ["dtc_history"] });
      void resetSyncWatermark();
    },
  });
}

export function useReadEcuInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => run((device) => device.readEcuInfo()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicle_info"] }),
  });
}
