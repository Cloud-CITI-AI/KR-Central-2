"use client";
import { lazy, Suspense } from "react";

// FE-9 (170 KB first load): the tables, filters and confirmations load on demand, requested as soon as the page hydrates, while
// the heading and the admin tabs (the page's `AdminHeader`) are in the first load. React.lazy so that the pages stay server-rendered
// inside a client boundary without next/dynamic's runtime.
const UsersPage = lazy(() => import("@/features/admin/UsersPage").then((module) => ({ default: module.UsersPage })));
const AuditPage = lazy(() => import("@/features/admin/AuditPage").then((module) => ({ default: module.AuditPage })));

/** `UsersPage` as its own chunk. */
export function LazyUsersPage() {
  return (
    <Suspense fallback={null}>
      <UsersPage />
    </Suspense>
  );
}

/** `AuditPage` as its own chunk. */
export function LazyAuditPage() {
  return (
    <Suspense fallback={null}>
      <AuditPage />
    </Suspense>
  );
}
