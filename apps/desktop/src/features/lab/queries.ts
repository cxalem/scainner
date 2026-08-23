// TanStack Query hooks for the UDS/Lab surface (ModuleManager, ProbeManager
// - DidReader/RangeScanner/ModuleFaults call DeviceService directly, they
// are one-shot manual actions, not cacheable reads, same as before this
// phase). Every queryFn/mutationFn runs through DeviceService
// (effect-architecture plan.md phase 2); this file only moved from the old
// single lib/queries.ts in phase 4 - no behavior change.
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

// Not in plan.md's named key list (research flagged Lab's child cards as
// "not audited individually... flagged for the planner to size" — see
// decisions-build.md). Follows the same "command name verbatim" rule.
//
// Scoped by vehicle (2026-08-24): a probe found on one car must never be
// attempted on another. null = no identified vehicle connected — returns
// only legacy (pre-scoping) global probes.
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

/// What previous discovery passes found for this vehicle. Local DB read —
/// works with no car connected, which is the point: findings persist.
export function useDiscoveredModules(vehicleId: number | null) {
  return useQuery({
    queryKey: ["discovered_modules", vehicleId],
    queryFn: () => run((device) => device.discoveredModules(vehicleId!)),
    enabled: vehicleId != null,
  });
}
