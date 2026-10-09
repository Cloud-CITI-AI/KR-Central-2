"use client";
import { hasCapability } from "@kr/contracts";
import Link from "next/link";
import { useSession } from "@/lib/session";
import styles from "./Admin.module.css";

export interface AdminHeaderProps {
  readonly current: "users" | "audit";
}

/** Title bar of an admin page (prototype `.dash-head`) with a link to each admin page the person may open. */
export function AdminHeader({ current }: AdminHeaderProps) {
  const { capabilities } = useSession();
  const pages = [
    { key: "users", href: "/admin/users", label: "Users", allowed: hasCapability(capabilities, "users.manage") },
    { key: "audit", href: "/admin/audit", label: "Audit trail", allowed: hasCapability(capabilities, "audit.read") },
  ] as const;
  const open = pages.filter((page) => page.allowed);
  return (
    <div className={styles.head}>
      <h2 className={styles.title}>{current === "users" ? "Users" : "Audit trail"}</h2>
      {open.length > 1 && (
        <nav aria-label="Administration" className={styles.nav}>
          {open.map((page) => (
            <Link
              key={page.key}
              href={page.href}
              className={styles.tab}
              {...(page.key === current ? { "aria-current": "page" as const } : {})}
            >
              {page.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
