import { ButtonLink } from "./ButtonLink";
import { StatusPage } from "./StatusPage";

export interface NotFoundPageProps {
  readonly requestId: string | null;
  /** Only the panel, inside a layout that already supplies the shell. */
  readonly inShell?: boolean;
}

/** Branded 404 with the request id. Also what a job the person may not see looks like (the API answers 404, not 403). */
export function NotFoundPage({ requestId, inShell = false }: NotFoundPageProps) {
  return (
    <StatusPage title="Page not found" requestId={requestId} inShell={inShell}>
      <p>We couldn't find that page. It may have moved, or you may not have access to it.</p>
      <p>
        <ButtonLink href="/" variant="primary">
          Back to the dashboard
        </ButtonLink>
      </p>
    </StatusPage>
  );
}
