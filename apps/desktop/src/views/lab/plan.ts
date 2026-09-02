import { useQuery } from "@tanstack/react-query";
import { invoke } from "@/lib/tauri";

export type ParkedPlan = {
  plan_version: string;
  brand_id: string | null;
  platform: string | null;
  targets: Array<{
    key: string;
    label: string;
    expected_family: string;
    req: string;
    resp: string;
    read_service: string;
    dids: Array<{ did: number; purpose: string }>;
    sweep: Array<[number, number]>;
    source: string;
  }>;
  sweep_budget_secs: number;
};

export type GuidedStep = {
  id: string;
  kind: "baseline" | "input";
  module: string | null;
  hypotheses: string[];
  precondition: Record<string, string | boolean>;
  instruction: string;
  condition_label: string;
  capture: { dids: string[]; reference_dids: Record<string, string[]>; repeats: number; hold_seconds: number };
  success: { expected: Record<string, string>; returns_after: boolean };
  applicable_if: Record<string, string>;
  optional: boolean;
  operator_confirmation: string | null;
  safety: string;
  estimated_seconds: number;
  on_success: string | null;
  on_failure: string | null;
};

export type GuidedSteps = {
  vehicle_id: number;
  plan_version: string;
  repeats: number;
  facts: Record<string, string | boolean | null>;
  steps: GuidedStep[];
};

export function useParkedPlan(vehicleId: number | null) {
  return useQuery({
    queryKey: ["parked_plan", vehicleId],
    queryFn: () => invoke<ParkedPlan | null>("parked_plan", { vehicleId }),
    enabled: vehicleId != null,
  });
}

export function useGuidedSteps(vehicleId: number | null) {
  return useQuery({
    queryKey: ["guided_steps", vehicleId],
    queryFn: () => invoke<GuidedSteps | null>("guided_steps", { vehicleId }),
    enabled: vehicleId != null,
  });
}

export function sweepSize(plan: ParkedPlan | null | undefined): number {
  if (!plan) return 0;
  return plan.targets.reduce((n, t) => n + t.sweep.reduce((m, [from, to]) => m + Math.max(0, to - from + 1), 0), 0);
}

export function identityReads(plan: ParkedPlan | null | undefined): number {
  if (!plan) return 0;
  return plan.targets.reduce((n, t) => n + t.dids.length, 0);
}

export function defaultSweepBand(plan: ParkedPlan | null | undefined, moduleKey: string): [number, number] | null {
  if (!plan) return null;
  const own = plan.targets.find((t) => t.key === moduleKey && t.sweep.length > 0);
  const any = plan.targets.find((t) => t.sweep.length > 0);
  return (own ?? any)?.sweep[0] ?? null;
}
