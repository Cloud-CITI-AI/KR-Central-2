import { QueryClient } from "@tanstack/react-query";
import { ApiProblem } from "@/lib/api/problem";

/** Data refreshes every 15 s while the tab is visible and on focus (PRODUCT_SPEC §14). */
export const REFETCH_INTERVAL_MS = 15_000;

/** Never retry a request the server understood and refused (4xx); retry transient failures twice. */
export function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiProblem && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchInterval: REFETCH_INTERVAL_MS,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        retry: shouldRetry,
      },
      mutations: { retry: false },
    },
  });
}
