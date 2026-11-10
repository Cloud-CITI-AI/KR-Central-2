"use client";
import { hasCapability } from "@kr/contracts/capabilities";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api, queryKeys } from "@/lib/api";
import { KrMark } from "@/components/ui/KrMark";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { useSession } from "@/lib/session";
import { readSidebarCollapsed, setSidebarCollapsed, subscribeSidebar } from "@/lib/sidebar";
import { readTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { cx } from "@/lib/cx";
import { Icons } from "./icons";
import styles from "./Shell.module.css";

export interface SidebarProps {
  /** Jobs needing attention (the Subdivision Tracker count badge); omitted when unknown. */
  readonly attentionCount?: number;
}

const THEMES: readonly { readonly value: Theme; readonly label: string; readonly Icon: (typeof Icons)["sun"] }[] = [
  { value: "system", label: "System theme", Icon: Icons.monitor },
  { value: "light", label: "Light theme", Icon: Icons.sun },
  { value: "dark", label: "Dark theme", Icon: Icons.moon },
];

const ROLE_LABEL = { admin: "Administrator", kr_admin: "KR Admin", staff: "Staff", external: "Client" } as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * KR Central's floating sidebar (§4): the KR mark and product name, the modules and admin pages the person may open,
 * the theme switch and sign-out in the user block. Folds to a 64px icon rail; the choice is kept in localStorage.
 * Externals (clients, architects) see Home and the Subdivision Tracker only.
 */
export function Sidebar({ attentionCount: given }: SidebarProps) {
  const me = useSession();
  const pathname = usePathname();
  const facets = useQuery({
    queryKey: queryKeys.jobs.facets({ status: "in_progress" }),
    queryFn: ({ signal }) => api("getJobFacets", { query: { status: "in_progress" }, signal }),
    enabled: given === undefined,
    staleTime: 60_000,
  });
  const attentionCount = given ?? facets.data?.needAttention;
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, (): Theme => "system");
  const caps = me.capabilities;
  const onSubdivisions = pathname === "/subdivisions" || pathname.startsWith("/jobs/");
  const current = (match: boolean) => (match ? ("page" as const) : undefined);
  const canUsers = hasCapability(caps, "users.manage");
  const canAudit = hasCapability(caps, "audit.read");
  const canTeams = me.features.teamsFileSync && hasCapability(caps, "teams.settings.read");
  const isStaffSide = me.user.role !== "external";

  return (
    <aside className={cx(styles.side, collapsed && styles.collapsed)} aria-label="KR Central">
      <Link href="/" className={styles.brand} aria-label="KR Central home">
        <span className={styles.mark}>
          <KrMark />
        </span>
        <span className={styles.brandText}>
          <b>KR CENTRAL</b>
          <span>KR Surveys</span>
        </span>
      </Link>
      <Link href="/" className={styles.item} aria-current={current(pathname === "/")}>
        <Icons.home />
        <span className={styles.label}>Home</span>
      </Link>
      <div className={styles.section}>Modules</div>
      <Link
        href="/subdivisions"
        className={styles.item}
        aria-current={current(onSubdivisions)}
        {...(attentionCount ? { "data-count": attentionCount } : {})}
      >
        <Icons.map />
        <span className={styles.label}>Subdivision Tracker</span>
        {attentionCount ? (
          <span className={styles.count} aria-label={`${attentionCount} jobs need attention`}>
            {attentionCount}
          </span>
        ) : null}
      </Link>
      {isStaffSide && (
        <Link
          href="/subdivisions"
          className={cx(styles.item, styles.sub)}
          aria-current={current(pathname === "/subdivisions")}
        >
          <span className={styles.label}>Dashboard</span>
        </Link>
      )}
      {(canUsers || canAudit || canTeams) && <div className={styles.section}>Admin</div>}
      {canUsers && (
        <Link href="/admin/users" className={styles.item} aria-current={current(pathname.startsWith("/admin/users"))}>
          <Icons.people />
          <span className={styles.label}>Users</span>
        </Link>
      )}
      {canAudit && (
        <Link href="/admin/audit" className={styles.item} aria-current={current(pathname.startsWith("/admin/audit"))}>
          <Icons.shield />
          <span className={styles.label}>Audit trail</span>
        </Link>
      )}
      {canTeams && (
        <Link href="/admin/teams" className={styles.item} aria-current={current(pathname.startsWith("/admin/teams"))}>
          <Icons.teams />
          <span className={styles.label}>Teams</span>
        </Link>
      )}
      <div className={styles.spacer} />
      <div className={styles.user}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(me.user.displayName)}
        </span>
        <span className={styles.userText}>
          <b>{me.user.displayName}</b>
          <small>{ROLE_LABEL[me.user.role]}</small>
        </span>
      </div>
      <div className={styles.userTools} role="group" aria-label="Theme">
        {THEMES.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            className={styles.tool}
            aria-label={label}
            title={label}
            aria-pressed={theme === value}
            onClick={() => {
              setTheme(value);
            }}
          >
            <Icon width={16} height={16} />
          </button>
        ))}
        <span className={styles.spacer} />
        <SignOutButton compact />
      </div>
      <button
        type="button"
        className={styles.fold}
        aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
        onClick={() => {
          setSidebarCollapsed(!collapsed);
        }}
      >
        {collapsed ? <Icons.chevronRight width={16} height={16} /> : <Icons.chevronLeft width={16} height={16} />}
      </button>
    </aside>
  );
}
