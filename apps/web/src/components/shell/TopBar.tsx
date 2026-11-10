"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import styles from "./Shell.module.css";

interface Crumb {
  readonly label: string;
  readonly href?: string;
}

/** Breadcrumbs from the route: Home / module / page. The tracker page shows the job number itself, below. */
export function crumbsFor(pathname: string): Crumb[] {
  if (pathname === "/") return [{ label: "Home" }];
  const home: Crumb = { label: "Home", href: "/" };
  if (pathname === "/subdivisions")
    return [home, { label: "Subdivision Tracker", href: "/subdivisions" }, { label: "Dashboard" }];
  if (pathname.startsWith("/jobs/"))
    return [home, { label: "Subdivision Tracker", href: "/subdivisions" }, { label: "Job" }];
  if (pathname.startsWith("/admin/")) {
    const page = pathname.split("/")[2] ?? "";
    const label = page === "users" ? "Users" : page === "audit" ? "Audit trail" : page === "teams" ? "Teams" : page;
    return [home, { label: "Admin" }, { label }];
  }
  return [home];
}

/** The strip above every page: breadcrumbs now; room for search and notifications when those features exist. */
export function TopBar() {
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname);
  return (
    <div className={styles.bar}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 && (
              <span className={styles.sep} aria-hidden="true">
                /
              </span>
            )}
            {i === crumbs.length - 1 ? (
              <span className={styles.current} aria-current="page">
                {c.label}
              </span>
            ) : c.href ? (
              <Link href={c.href}>{c.label}</Link>
            ) : (
              <span>{c.label}</span>
            )}
          </Fragment>
        ))}
      </nav>
    </div>
  );
}
