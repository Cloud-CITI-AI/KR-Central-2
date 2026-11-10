import type { ReactNode } from "react";
import { PublicCard, PublicShell } from "@/components/shell/PublicShell";
import { Panel } from "./Panel";
import styles from "./StatusPage.module.css";

export interface StatusPageProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Shown so the person can quote it to KR Surveys (404 / 500 pages, EH-1). */
  readonly requestId?: string | null | undefined;
  /** Only the panel: for a layout that already supplies the shell and `<main>` (never nest a second shell). */
  readonly inShell?: boolean;
}

/** Full page for not-found and error states: one titled card (the page's h1), request id. Works without a session. */
export function StatusPage({ title, children, requestId, inShell = false }: StatusPageProps) {
  const body = (
    <>
      {children}
      {requestId && <p>Request ID: {requestId}</p>}
    </>
  );
  if (inShell) {
    return (
      <div className={styles.inShell}>
        <Panel title={title} headingLevel={1}>
          {body}
        </Panel>
      </div>
    );
  }
  return (
    <PublicShell>
      <PublicCard title={title}>{body}</PublicCard>
    </PublicShell>
  );
}
