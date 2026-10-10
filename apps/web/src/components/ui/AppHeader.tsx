import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeControl } from "./ThemeControl";
import { Wrap } from "./Wrap";
import styles from "./AppHeader.module.css";

/** Served from `public/brand` (a copy of the design-tokens asset, kept identical by a test): a static path needs no SVG module typings, which exist only after `next build` has written next-env.d.ts. */
const LOGO_SRC = "/brand/kr-surveys-logo.svg";

export interface AppHeaderProps {
  /** The hero-bar controls. Defaults to the theme control alone (public pages have no session). */
  readonly controls?: ReactNode;
}

/**
 * The prototype hero header: KR logo (a link home), "SUBDIVISION TRACKER" tag, H1, orange rule and tagline, plus the controls on the
 * right of the hero bar (§4). A server component, so the public pages do not ship the session and API code the signed-in
 * controls (`HeaderAccount`) need.
 */
export function AppHeader({ controls = <ThemeControl /> }: AppHeaderProps) {
  return (
    <header className={styles.top}>
      <Wrap className={styles.inner}>
        <div className={styles.bar}>
          <Link href="/" className={styles.brand} aria-label="KR Surveys home">
            <Image className={styles.logo} src={LOGO_SRC} alt="" width={122} height={40} unoptimized />
          </Link>
          <div className={styles.tools}>
            <span className={styles.tag}>Subdivision Tracker</span>
            <div className={styles.controls}>{controls}</div>
          </div>
        </div>
        <div className={styles.text}>
          <h1 className={styles.title}>KR Surveys Subdivision Tracker</h1>
          <span className={styles.sep} />
          <p className={styles.sub}>Keeping you up to date with your subdivision</p>
        </div>
      </Wrap>
    </header>
  );
}
