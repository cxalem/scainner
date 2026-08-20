// TanStack Query hooks for the UDS/Lab surface (ModuleManager, ProbeManager
// - DidReader/RangeScanner/ModuleFaults call DeviceService directly, they
// are one-shot manual actions, not cacheable reads, same as before this
// phase). Every queryFn/mutationFn runs through DeviceService
// (effect-architecture plan.md phase 2); this file only moved from the old
// single lib/queries.ts in phase 4 - no behavior change.
import { Effect } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@/core/services/device-service";
import type { UdsProbe } from "@/features/lab/schema";

const run = <A, E>(f: (s: Effect.Effect.Success<typeof DeviceService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(DeviceService, f));

export function useUdsModules() {
  return useQuery({
    queryKey: ["uds_modules"],
    queryFn: () => run((s) => s.udsModules()),
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
