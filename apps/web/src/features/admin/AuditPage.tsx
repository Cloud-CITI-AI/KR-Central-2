"use client";
import { hasCapability } from "@kr/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { api, queryKeys } from "@/lib/api";
import { useSession } from "@/lib/session";
import styles from "./Admin.module.css";
import { AuditFilters, type AuditFilterValues } from "./AuditFilters";
import { AuditTable } from "./AuditTable";
import { isInRange, perthDateRange } from "./perth-range";
import { ProblemNotice } from "./ProblemNotice";
import { useDebouncedValue } from "./useDebouncedValue";
import { useJobLookup } from "./useJobLookup";

const EMPTY: AuditFilterValues = { job: "", actorId: "", action: "", from: "", to: "" };
/** Pages fetched on their own while looking back to the start of a date range (100 events each). */
const MAX_AUTO_PAGES = 20;

/**
 * `/admin/audit` (§9.2): the audit trail newest first, 100 at a time, filtered by job, user, action (all by the API) and
 * by a Perth date range. The contract has no date parameters, so the range is applied here: pages are fetched until the
 * start of the range has been passed.
 */
export function AuditPage() {
  const { capabilities } = useSession();
  const [values, setValues] = useState(EMPTY);
  const action = useDebouncedValue(values.action.trim());
  const { options: jobOptions, jobId } = useJobLookup(values.job);
  const jobUnresolved = values.job.trim() !== "" && jobId === undefined;
  const range = perthDateRange(values.from, values.to);

  const events = useInfiniteQuery({
    queryKey: queryKeys.audit({ jobId, actorId: values.actorId, action }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api("listAuditEvents", {
        query: {
          limit: 100,
          ...(jobId ? { jobId } : {}),
          ...(values.actorId ? { actorId: values.actorId } : {}),
          ...(action ? { action } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: false, // reading diffs: rows must not move under the reader
    // Text that names no job must not fall back to the unfiltered trail: it would read as that job's events.
    enabled: !jobUnresolved,
  });
  const loaded = events.data?.pages.flatMap((page) => page.items) ?? [];
  const shown = loaded.filter((event) => isInRange(event.occurredAt, range));

  const users = useQuery({
    queryKey: queryKeys.users({ picker: "audit" }),
    queryFn: ({ signal }) => api("listUsers", { query: { limit: 100 }, signal }),
    enabled: hasCapability(capabilities, "users.manage"),
  });
  const actors = new Map<string, string>();
  for (const user of users.data?.items ?? []) actors.set(user.id, user.displayName);
  for (const { actor } of loaded) if (actor) actors.set(actor.id, actor.displayName);

  const oldest = loaded.at(-1)?.occurredAt;
  // The trail is newest first: once an event is older than the start of the range (or the range runs backwards), no
  // older page can hold a match, so the list is complete for this range even though the API has more.
  const rangeExhausted =
    range.from !== undefined &&
    ((range.to !== undefined && range.from > range.to) || (oldest !== undefined && Date.parse(oldest) < range.from));
  // While the Job text names no job the query is off (and its key is the unfiltered one): never page it.
  const hasMore = events.hasNextPage && !rangeExhausted && !jobUnresolved;
  const lookingBack = range.from !== undefined || (range.to !== undefined && shown.length === 0);
  const fetchNext = events.fetchNextPage;
  const wantsMore =
    hasMore && !events.isFetchingNextPage && lookingBack && (events.data?.pages.length ?? 0) < MAX_AUTO_PAGES;
  useEffect(() => {
    if (wantsMore) void fetchNext();
  }, [wantsMore, fetchNext]);

  return (
    <section className={styles.panel} aria-label="Audit trail">
      <AuditFilters
        values={values}
        onChange={(change) => {
          setValues((current) => ({ ...current, ...change }));
        }}
        jobOptions={jobOptions}
        jobUnresolved={jobUnresolved}
        actors={[...actors].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))}
      />
      {jobUnresolved && <EmptyState>Choose a job number from the list to see its events.</EmptyState>}
      {events.isPending && !jobUnresolved && <Spinner label="Loading the audit trail…" />}
      {events.isError && (
        <ProblemNotice
          error={events.error}
          onRetry={() => {
            void events.refetch();
          }}
        />
      )}
      {events.isSuccess &&
        !jobUnresolved &&
        (shown.length === 0 && !hasMore ? (
          <EmptyState>No events match. Try different filters.</EmptyState>
        ) : (
          <>
            <p className={styles.summary} role="status">
              {shown.length} {shown.length === 1 ? "event" : "events"}
              {hasMore ? " so far" : ""}
            </p>
            <AuditTable events={shown} />
          </>
        ))}
      {hasMore && (
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
