"use client";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateNoteRequest } from "@kr/contracts";
import type { z } from "zod";
import { api, queryKeys } from "@/lib/api";
import type { Note } from "./types";

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

export type NoteBody = z.input<typeof CreateNoteRequest>;

/** Add a note; the list is reloaded so it shows the server's copy (author, time, id). */
export function useAddNote(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<Note, Error, NoteBody>({
    mutationFn: (body) => api("createNote", { params: { jobId }, body, idempotencyKey: crypto.randomUUID() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobs.notes(jobId) }),
  });
}
