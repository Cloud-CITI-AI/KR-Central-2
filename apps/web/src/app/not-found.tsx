import type { Metadata } from "next";
import { headers } from "next/headers";
import { NotFoundPage } from "@/components/ui/NotFoundPage";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Branded 404 with the request id, public only: it is in every route's first load, so it must not import the signed-in shell
 * and its client providers (FE-9, 170 KB). A signed-in person's unknown URL never gets here: the `(app)/[...notFound]` catch-all
 * calls `notFound()` inside the (app) layout, which frames `(app)/not-found.tsx` with the header, Admin, Sign out and footer.
 */
export default async function NotFound() {
  return <NotFoundPage requestId={(await headers()).get("x-request-id")} />;
}
