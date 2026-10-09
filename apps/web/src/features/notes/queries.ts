"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";

/** "Notes paginate (load more) after 50" (§5.7). */
export const NOTES_PAGE_SIZE = 50;

/** The job's notes, newest first as the API returns them; `fetchNextPage` is "Load more". */
export function useNotes(jobId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.jobs.notes(jobId),
    queryFn: ({ pageParam, signal }) =>
      api("listNotes", { params: { jobId }, query: { limit: NOTES_PAGE_SIZE, cursor: pageParam }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
