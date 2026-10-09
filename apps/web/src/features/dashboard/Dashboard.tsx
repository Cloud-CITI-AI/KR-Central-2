"use client";
import { Banner } from "@/components/ui/Banner";
import { ApiProblem } from "@/lib/api";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardJobbar } from "./DashboardJobbar";
import { archivedText, loadFailedText } from "./messages";
import { SummaryChips } from "./SummaryChips";
import { useJobFacets } from "./queries";
import { useDashboardParams } from "./useDashboardParams";
import styles from "./Dashboard.module.css";

/** The dashboard (§6): filters in the URL, counts from `getJobFacets`. Cards and forms follow below. */
export function Dashboard() {
  const { params, update } = useDashboardParams();
  const facets = useJobFacets(params.status);
  return (
    <>
      <DashboardJobbar />
      <div className={styles.dash}>
        {params.archived && (
          <div role="status">
            <Banner
              onDismiss={() => {
                update({ archived: "" });
              }}
            >
              {archivedText(params.archived)}
            </Banner>
          </div>
        )}
        {facets.isError && (
          <Banner>{loadFailedText(facets.error instanceof ApiProblem ? facets.error.requestId : undefined)}</Banner>
        )}
        <DashboardHeader params={params} facets={facets.data} onChange={update} />
        {facets.data && <SummaryChips facets={facets.data} />}
      </div>
    </>
  );
}
