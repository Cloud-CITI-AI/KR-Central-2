"use client";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { AccessManager } from "@/features/access";
import { useSession } from "@/lib/session";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardJobbar } from "./DashboardJobbar";
import { JobGrid } from "./JobGrid";
import { NewJobForm } from "./NewJobForm";
import { archivedText, dashboardFailureText } from "./messages";
import { SummaryChips } from "./SummaryChips";
import { useJobFacets, useJobList } from "./queries";
import { useDashboardParams } from "./useDashboardParams";
import styles from "./Dashboard.module.css";

const NEW_JOB_BUTTON_ID = "new-job-button";

/** The dashboard (§6): filters in the URL, counts from `getJobFacets`. The cards follow the counts. */
export function Dashboard() {
  const { params, update } = useDashboardParams();
  const facets = useJobFacets(params.status);
  const jobs = useJobList(params);
  // One banner for both queries: a failed refresh keeps what was loaded, so say it may be out of date.
  const failed = [jobs, facets].filter((query) => query.isError);
  const failure = failed[0]
    ? dashboardFailureText(
        failed[0].error,
        failed.every((query) => query.data !== undefined),
      )
    : null;
  const canCreate = useSession().capabilities.includes("jobs.create");
  const [creating, setCreating] = useState(false);
  return (
    <>
      <DashboardJobbar />
      <div className={styles.dash}>
        <div role="status" className={styles.live}>
          {params.archived && (
            <Banner
              onDismiss={() => {
                update({ archived: "" });
              }}
            >
              {archivedText(params.archived)}
            </Banner>
          )}
          {failure && <Banner>{failure}</Banner>}
        </div>
        <DashboardHeader
          params={params}
          facets={facets.data}
          onChange={update}
          actions={
            canCreate && (
              <Button
                id={NEW_JOB_BUTTON_ID}
                variant="primary"
                aria-expanded={creating}
                onClick={() => {
                  setCreating((open) => !open);
                }}
              >
                New job
              </Button>
            )
          }
        >
          {canCreate && creating && (
            <NewJobForm
              onCancel={() => {
                setCreating(false);
                document.getElementById(NEW_JOB_BUTTON_ID)?.focus();
              }}
            />
          )}
        </DashboardHeader>
        {facets.data && <SummaryChips facets={facets.data} />}
        <JobGrid params={params} visibleJobs={facets.data?.statusCounts.all} />
      </div>
      <AccessManager />
    </>
  );
}
