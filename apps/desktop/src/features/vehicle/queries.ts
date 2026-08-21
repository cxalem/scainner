// TanStack Query hooks for the vehicle-identity/report surface (Overview,
// History, Vehicle.tsx). Every queryFn/mutationFn runs through
// DeviceService (effect-architecture plan.md phase 2). Schema v2
// (docs/workflows/data-core/plan.md): everything is keyed by the vehicle
// entity's id — never by a VIN string, which is a nullable attribute now.
import { Effect } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";

const run = <A, E>(f: (device: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

export function useVehicles() {
  return useQuery({
    queryKey: ["list_vehicles"],
    queryFn: () => run((device) => device.listVehicles()),
  });
}

// No placeholderData/keepPreviousData on purpose — a vehicle change must drop
// to the skeleton, never show the previous car's report (plan.md rule 12).
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

// The "name this car" flow for a live VIN-less connection — the supervisor
// re-emits conn-status itself, so the identity update reaches App.tsx
// through the normal event path; these invalidations refresh the lists.
export function useNameCurrentVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string }) => run((device) => device.nameCurrentVehicle(vars.name)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["list_vehicles"] });
      void qc.invalidateQueries({ queryKey: ["vehicle_report"] });
      void qc.invalidateQueries({ queryKey: ["dtc_history"] });
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
