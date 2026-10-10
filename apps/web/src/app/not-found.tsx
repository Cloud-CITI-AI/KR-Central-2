import type { Metadata } from "next";
import { headers } from "next/headers";
import { NotFoundPage } from "@/components/ui/NotFoundPage";

export const metadata: Metadata = { title: "Page not found" };

/** Branded 404 with the request id, for URLs that match no route. Also what a job the person may not see looks like (the API answers 404, not 403). */
export default async function NotFound() {
  return <NotFoundPage requestId={(await headers()).get("x-request-id")} />;
}
