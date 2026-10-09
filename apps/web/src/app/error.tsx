"use client";
import { Button } from "@/components/ui/Button";
import { StatusPage } from "@/components/ui/StatusPage";

interface ErrorPageProps {
  readonly error: Error & { readonly digest?: string; readonly requestId?: string };
  readonly reset: () => void;
}

/** Branded 500 for errors below the root layout. Shows the request id (API problems) or Next's error digest. */
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <StatusPage title="Something went wrong" requestId={error.requestId ?? error.digest}>
      <p>
        Something went wrong on our side. Please try again; if it keeps happening, contact KR Surveys and quote the
        request ID.
      </p>
      <p>
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      </p>
    </StatusPage>
  );
}
