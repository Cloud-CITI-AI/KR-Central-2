"use client";
import "@kr/design-tokens/tokens.css";
import { Button } from "@/components/ui/Button";
import { StatusPage } from "@/components/ui/StatusPage";

interface GlobalErrorProps {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}

/** Last resort when the root layout itself fails: it replaces the layout, so it brings its own <html> and tokens. */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en-AU">
      <body>
        <StatusPage title="Something went wrong" requestId={error.digest}>
          <p>
            The tracker couldn't be loaded. Please try again; if it keeps happening, contact KR Surveys and quote the
            request ID.
          </p>
          <p>
            <Button variant="primary" onClick={reset}>
              Try again
            </Button>
          </p>
        </StatusPage>
      </body>
    </html>
  );
}
