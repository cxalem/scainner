import { Effect } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import type { UdsProbe } from "@scainner/core";

const run = <A, E>(f: (device: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

export function useUdsModules() {
  return useQuery({
    queryKey: ["uds_modules"],
    queryFn: () => run((device) => device.udsModules()),
  });
}

export function useListProbes(vehicleId: number | null) {
  return useQuery({
    queryKey: ["list_probes", vehicleId],
    queryFn: () => run((device) => device.listProbes(vehicleId)),
  });
}

export function useAddUdsModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { key: string; label: string; req: string; resp: string }) =>
      run((device) => device.addUdsModule(vars)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["uds_modules"] }),
  });
}

export function useDeleteUdsModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { key: string }) => run((device) => device.deleteUdsModule(vars.key)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["uds_modules"] }),
  });
}

export function useAddProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { probe: UdsProbe; vehicleId: number | null }) => run((device) => device.addProbe(vars.probe, vars.vehicleId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["list_probes"] }),
  });
}

export function useToggleProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; enabled: boolean }) => run((device) => device.toggleProbe(vars.id, vars.enabled)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["list_probes"] }),
  });
}

export function useDeleteProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number }) => run((device) => device.deleteProbe(vars.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["list_probes"] }),
  });
}

export function useDiscoveredModules(vehicleId: number | null) {
  return useQuery({
    queryKey: ["discovered_modules", vehicleId],
    queryFn: () => run((device) => device.discoveredModules(vehicleId!)),
    enabled: vehicleId != null,
  });
}

export function useRunDiscovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { vehicleId: number }) => run((device) => device.runDiscovery(vars.vehicleId)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["discovered_modules"] });
      void qc.invalidateQueries({ queryKey: ["vehicle_evidence_map"] });
    },
  });
}

export function useFingerprintExperiment() {
  return useQuery({
    queryKey: ["fingerprint_experiment"],
    queryFn: () => run((device) => device.fingerprintExperiment()),
  });
}
