import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { Panel } from "./Panel";
import styles from "./StatusPage.module.css";
import { Wrap } from "./Wrap";

export interface StatusPageProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Shown so the person can quote it to KR Surveys (404 / 500 pages, EH-1). */
  readonly requestId?: string | null | undefined;
  /** Only the panel: for a layout that already supplies the hero header and `<main>` (never nest a second shell). */
  readonly inShell?: boolean;
}

/** Full page for not-found and error states: hero header, one panel, request id. Works without a session. */
export function StatusPage({ title, children, requestId, inShell = false }: StatusPageProps) {
  const panel = (
    <Panel title={title}>
      {children}
      {requestId && <p>Request ID: {requestId}</p>}
    </Panel>
  );
  if (inShell) return <div className={styles.inShell}>{panel}</div>;
  return (
    <>
      <AppHeader />
      <Wrap as="main" spaced>
        {panel}
      </Wrap>
    </>
  );
}
