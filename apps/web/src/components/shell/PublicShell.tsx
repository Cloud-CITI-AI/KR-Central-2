import Link from "next/link";
import type { ReactNode } from "react";
import { KrMark } from "@/components/ui/KrMark";
import { PublicThemeTools } from "./PublicThemeTools";
import styles from "./PublicShell.module.css";

export interface PublicShellProps {
  readonly children: ReactNode;
  /** The feedback form's address, when configured (the layout reads it on the server; error pages pass none). */
  readonly feedbackUrl?: string | undefined;
}

/** The frame of the pages without a session (§3.1): the brand line, the photo wash, one card, a one-line footer. */
export function PublicShell({ children, feedbackUrl }: PublicShellProps) {
  return (
    <div className={styles.canvas}>
      <header className={styles.top}>
        <Link href="/" className={styles.brand} aria-label="KR Central home">
          <span className={styles.mark}>
            <KrMark />
          </span>
          <span className={styles.brandText}>
            <b>KR CENTRAL</b>
            <span>KR Surveys · operations portal</span>
          </span>
        </Link>
        <PublicThemeTools />
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <span>KR Surveys</span>
        {feedbackUrl && (
          <a href={feedbackUrl} target="_blank" rel="noopener noreferrer">
            Send feedback
          </a>
        )}
      </footer>
    </div>
  );
}

/** The one card a public page shows. */
export function PublicCard({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className={styles.card} aria-labelledby="public-card-title">
      <h1 id="public-card-title">{title}</h1>
      {children}
    </section>
  );
}
