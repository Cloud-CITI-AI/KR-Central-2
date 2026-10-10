import { headers } from "next/headers";
import { NotFoundPage } from "@/components/ui/NotFoundPage";

/** `notFound()` inside the signed-in area (a job the person may not see, an archived job): only the panel, in the (app) shell. */
export default async function AppNotFound() {
  return <NotFoundPage requestId={(await headers()).get("x-request-id")} inShell />;
}
