import type { Metadata } from "next";
import { Suspense } from "react";
import { Dashboard } from "@/features/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

/** The Subdivision Tracker dashboard (§6), at /subdivisions since KR Central became the home page. */
export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
