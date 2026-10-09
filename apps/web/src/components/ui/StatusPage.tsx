import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { Panel } from "./Panel";
import { Wrap } from "./Wrap";

export interface StatusPageProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Shown so the person can quote it to KR Surveys (404 / 500 pages, EH-1). */
  readonly requestId?: string | null | undefined;
}

/** Full page for not-found and error states: hero header, one panel, request id. Works without a session. */
export function StatusPage({ title, children, requestId }: StatusPageProps) {
  return (
    <>
      <AppHeader />
      <Wrap as="main" spaced>
        <Panel title={title}>
          {children}
          {requestId && <p>Request ID: {requestId}</p>}
        </Panel>
      </Wrap>
    </>
  );
}
