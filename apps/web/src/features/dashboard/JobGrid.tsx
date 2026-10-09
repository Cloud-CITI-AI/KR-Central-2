"use client";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { ApiProblem } from "@/lib/api";
import { useSession } from "@/lib/session";
import { DashboardCard } from "./DashboardCard";
import { GRID_MESSAGES, loadFailedText } from "./messages";
import type { DashboardParams } from "./params";
import { useJobList } from "./queries";
import styles from "./JobGrid.module.css";

export interface JobGridProps {
  readonly params: DashboardParams;
  /** Every job the user can see (`statusCounts.all`); undefined until the counts load. */
  readonly visibleJobs: number | undefined;
}

/** The cards grid (§6): server-sorted cards, "Load more" at 50, skeletons, empty and problem states. */
export function JobGrid({ params, visibleJobs }: JobGridProps) {
  const { user } = useSession();
  const jobs = useJobList(params);
  const cards = jobs.data?.pages.flatMap((page) => page.items) ?? [];

  if (jobs.isError && !jobs.data) {
    return <Banner>{loadFailedText(jobs.error instanceof ApiProblem ? jobs.error.requestId : undefined)}</Banner>;
  }
  if (jobs.isPending) {
    return (
      <div role="status" className={styles.grid}>
        <VisuallyHidden>{GRID_MESSAGES.loading}</VisuallyHidden>
        {[0, 1, 2].map((n) => (
          <div key={n} className={styles.skeleton} aria-hidden="true" />
        ))}
      </div>
    );
  }
  if (cards.length === 0) {
    return (
      <p className={styles.none}>
        {user.role === "external" && visibleJobs === 0 ? GRID_MESSAGES.noAccess : GRID_MESSAGES.noMatch}
      </p>
    );
  }
  return (
    <>
      <ul className={styles.grid} aria-busy={jobs.isPlaceholderData}>
        {cards.map((job) => (
          <li key={job.id}>
            <DashboardCard job={job} />
          </li>
        ))}
      </ul>
      {jobs.hasNextPage && (
        <div className={styles.more}>
          <Button
            disabled={jobs.isFetchingNextPage}
            onClick={() => {
              void jobs.fetchNextPage();
            }}
          >
            {jobs.isFetchingNextPage ? GRID_MESSAGES.loading : GRID_MESSAGES.loadMore}
          </Button>
        </div>
      )}
    </>
  );
}
