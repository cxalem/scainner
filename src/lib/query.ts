// Singleton TanStack Query client for every Tauri `invoke` read in the app —
// one consistent cache, loading/error shape, and invalidation surface
// instead of the per-view useState+useEffect fetches this replaces. Defaults
// are pinned deliberately, not left to the builder — see
// docs/workflows/app-perf/decisions-plan.md ("staleTime 15s,
// refetchOnWindowFocus off") for the reasoning.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
