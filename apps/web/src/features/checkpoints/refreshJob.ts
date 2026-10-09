import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api";

/**
 * Refetch what a write to a checkpoint or its files changes: the job detail (progress, stage bars, file count) and the
 * dashboard and picker lists. The job notes are not affected.
 */
export function refreshJob(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all, predicate: (q) => q.queryKey[1] !== "notes" });
}
