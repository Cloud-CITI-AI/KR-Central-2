"use client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { api, queryKeys } from "@/lib/api";
import { useLastJobId } from "./lastJob";
import styles from "./DashboardJobbar.module.css";

/**
 * Dashboard jobbar (§4): "← BACK TO TRACKER" to the last opened job and "Save as PDF" (the browser print dialog; the
 * print stylesheet hides buttons and the access manager). The back link is hidden when no job is remembered or the
 * job is no longer visible to the user (archived, access revoked), which `getJob` answers with a 404.
 */
export function DashboardJobbar() {
  const lastJobId = useLastJobId();
  const lastJob = useQuery({
    queryKey: queryKeys.jobs.detail(lastJobId ?? ""),
    queryFn: ({ signal }) => api("getJob", { params: { jobId: lastJobId ?? "" }, signal }),
    enabled: lastJobId !== null,
    staleTime: 60_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  return (
    <div className={styles.jobbar}>
      {lastJobId && lastJob.isSuccess && (
        <ButtonLink href={`/jobs/${lastJobId}`} variant="primary">
          <span aria-hidden="true">←</span> Back to tracker
        </ButtonLink>
      )}
      <Button
        onClick={() => {
          window.print();
        }}
      >
        Save as PDF
      </Button>
    </div>
  );
}
