import { headers } from "next/headers";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { StatusPage } from "@/components/ui/StatusPage";

/** Branded 404 with the request id. Also what a job the person may not see looks like (the API answers 404, not 403). */
export default async function NotFound() {
  const requestId = (await headers()).get("x-request-id");
  return (
    <StatusPage title="Page not found" requestId={requestId}>
      <p>We couldn't find that page. It may have moved, or you may not have access to it.</p>
      <p>
        <ButtonLink href="/" variant="primary">
          Back to the dashboard
        </ButtonLink>
      </p>
    </StatusPage>
  );
}
