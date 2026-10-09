"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { api, queryKeys } from "@/lib/api";
import styles from "./Admin.module.css";
import { AuditTable } from "./AuditTable";
import { ProblemNotice } from "./ProblemNotice";

/** `/admin/audit` (§9.2): the audit trail, newest first, 100 events at a time. */
export function AuditPage() {
  const events = useInfiniteQuery({
    queryKey: queryKeys.audit({}),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api("listAuditEvents", { query: { limit: 100, ...(pageParam ? { cursor: pageParam } : {}) }, signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: false, // reading diffs: rows must not move under the reader
  });
  const rows = events.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className={styles.panel} aria-label="Audit trail">
      {events.isPending && <Spinner label="Loading the audit trail…" />}
      {events.isError && (
        <ProblemNotice
          error={events.error}
          onRetry={() => {
            void events.refetch();
          }}
        />
      )}
      {events.isSuccess &&
        (rows.length === 0 ? (
          <EmptyState>No events yet.</EmptyState>
        ) : (
          <>
            <p className={styles.summary} role="status">
              {rows.length} {rows.length === 1 ? "event" : "events"}
              {events.hasNextPage ? " so far" : ""}
            </p>
            <AuditTable events={rows} />
          </>
        ))}
      {events.hasNextPage && (
        <Button
          className={styles.more}
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </section>
  );
}
