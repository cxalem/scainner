import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { BillingService } from "@scainner/core";
import { runPromise } from "@/core/runtime";

const run = <A, E>(f: (billing: Effect.Effect.Success<typeof BillingService>) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(BillingService, f));

export function usePricing(refetchInterval: number | false = false) {
  return useQuery({ queryKey: ["report_pricing"], queryFn: () => run((billing) => billing.pricing()), refetchInterval });
}

export function useReports() {
  return useQuery({ queryKey: ["reports"], queryFn: () => run((billing) => billing.listReports()) });
}

export const billingRun = run;
