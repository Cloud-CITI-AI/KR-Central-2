import type { Metadata } from "next";
import { Suspense } from "react";
import { Dashboard } from "@/features/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

/** The dashboard, first page after sign-in. The (app) layout owns <main> and the h1. */
export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
