"use client";
import { lazy, Suspense } from "react";
import { DashboardJobbar } from "./DashboardJobbar";
import { DashboardSkeleton } from "./DashboardSkeleton";
// The content chunk's styles are requested when its script has run, which on a slow link is seconds after the chunk (the header
// first drew unstyled, then every block moved: CLS 0.30). Imported here, they travel with the page's own CSS, so the content
// is styled the moment it mounts. CSS is not JS: the FE-9 byte budget is untouched.
import "./DashboardCard.module.css";
import "./DashboardHeader.module.css";
import "./JobGrid.module.css";
import "./SummaryChips.module.css";

// FE-9 (170 KB first load): the filters, the counts and the cards (everything but the jobbar) are one chunk, requested as soon as
// the page hydrates, in parallel with the job list it asks for. DashboardSkeleton holds its place at the same size (CLS). React.lazy: next/dynamic's runtime is not worth its bytes here.
const DashboardContent = lazy(() =>
  import("./DashboardContent").then((module) => ({ default: module.DashboardContent })),
);

/** The dashboard (§6): the jobbar, then the filters and the cards. */
export function Dashboard() {
  return (
    <>
      <DashboardJobbar />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </>
  );
}
