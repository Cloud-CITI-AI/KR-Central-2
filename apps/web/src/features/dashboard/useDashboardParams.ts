"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { dashboardHref, parseDashboardParams, type DashboardParams } from "./params";

/** The dashboard filters from the URL and a setter that replaces the URL (no history entry per keystroke). */
export function useDashboardParams() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const params = useMemo(() => parseDashboardParams(search), [search]);
  const update = useCallback(
    (patch: Partial<DashboardParams>) => {
      router.replace(dashboardHref(pathname, search, patch), { scroll: false });
    },
    [router, pathname, search],
  );
  return { params, update };
}
