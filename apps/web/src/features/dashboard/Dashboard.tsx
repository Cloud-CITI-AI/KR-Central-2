"use client";
import { lazy, Suspense } from "react";
import { DashboardJobbar } from "./DashboardJobbar";

// FE-9 (170 KB first load): the filters, the counts and the cards (everything but the jobbar) are one chunk, requested as soon as
// the page hydrates, in parallel with the job list it asks for. React.lazy: next/dynamic's runtime is not worth its bytes here.
const DashboardContent = lazy(() =>
  import("./DashboardContent").then((module) => ({ default: module.DashboardContent })),
);

/** The dashboard (§6): the jobbar, then the filters and the cards. */
export function Dashboard() {
  return (
    <>
      <DashboardJobbar />
      <Suspense fallback={null}>
        <DashboardContent />
      </Suspense>
    </>
  );
}
