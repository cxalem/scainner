// TanStack Query hooks for the vehicle-identity/car-report surface
// (Overview, History, Vehicle.tsx). Every queryFn/mutationFn runs through
// DeviceService (effect-architecture plan.md phase 2); this file only
// moved from the old single lib/queries.ts in phase 4 — no behavior change.
import { Effect } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@/core/services/device-service";

const run = <A, E>(f: (device: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

export function useReportCars() {
  return useQuery({
    queryKey: ["report_cars"],
    queryFn: () => run((device) => device.reportCars()),
  });
}

// No placeholderData/keepPreviousData on purpose — a VIN change must drop to
// the skeleton, never show the previous car's report (plan.md rule 12).
export function useCarReport(vin: string | null) {
  return useQuery({
    queryKey: ["car_report", vin],
    queryFn: () => run((device) => device.carReport(vin!)),
    enabled: vin != null,
  });
}

export function useCarInfo() {
  return useQuery({
    queryKey: ["car_info"],
    queryFn: () => run((device) => device.carInfo()),
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
    mutationFn: (vars: { price: number }) => run((device) => device.setFuelPrice(vars.price)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["car_report"] }),
  });
}

export function useReadEcuInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => run((device) => device.readEcuInfo()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["car_info"] }),
  });
}
