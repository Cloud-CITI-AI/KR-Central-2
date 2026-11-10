"use client";
import type { JobCard } from "@kr/contracts";
import { hasCapability } from "@kr/contracts/capabilities";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Icons } from "@/components/shell/icons";
import { api, queryKeys } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cx } from "@/lib/cx";
import styles from "./Home.module.css";

/** "Good morning / afternoon / evening" in the person's local time. */
export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The sentence under the greeting (the one finding, §6 wording), or nothing while counts load. */
export function findingText(f: {
  needAttention: number;
  waitingOnClient: number;
  inProgress: number;
  complete: number;
}): string {
  const parts = [
    f.needAttention === 1 ? "1 job needs attention" : `${f.needAttention} jobs need attention`,
    f.waitingOnClient === 1 ? "1 is waiting on a client" : `${f.waitingOnClient} are waiting on a client`,
    `${f.inProgress} in progress, ${f.complete} complete`,
  ];
  return parts.join(" · ");
}

function firstName(displayName: string): string {
  return displayName.split(/\s+/)[0] ?? displayName;
}

/** Jobs with alerts, most urgent first, for the "Needs you" list: at most eight. */
export function attentionItems(jobs: readonly JobCard[]): { job: JobCard; level: "bad" | "warn"; text: string }[] {
  return jobs
    .filter((j) => j.alerts.length > 0)
    .map((j) => {
      const alert = j.alerts.find((a) => a.level === "bad") ?? j.alerts[0];
      return { job: j, level: alert?.level ?? "warn", text: alert?.text ?? "" };
    })
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1))
    .slice(0, 8);
}

/**
 * The KR Central home page (§4): what needs the person across modules, and the modules they may open. Externals see
 * their jobs' tile and attention items only; admins also see the admin pages as tiles.
 */
export function Home() {
  const me = useSession();
  const hour = new Date().getHours();
  const facets = useQuery({
    queryKey: queryKeys.jobs.facets({ status: "in_progress" }),
    queryFn: ({ signal }) => api("getJobFacets", { query: { status: "in_progress" }, signal }),
  });
  const complete = useQuery({
    queryKey: queryKeys.jobs.facets({ status: "all" }),
    queryFn: ({ signal }) => api("getJobFacets", { query: { status: "all" }, signal }),
  });
  const jobs = useQuery({
    queryKey: queryKeys.jobs.list({ view: "home", status: "in_progress", type: "", q: "" }),
    queryFn: ({ signal }) =>
      api("listJobs", { query: { status: "in_progress", sort: "attention", limit: 50 }, signal }),
  });
  const canUsers = hasCapability(me.capabilities, "users.manage");
  const canAudit = hasCapability(me.capabilities, "audit.read");
  const canTeams = me.features.teamsFileSync && hasCapability(me.capabilities, "teams.settings.read");
  const counts = facets.data
    ? {
        needAttention: facets.data.needAttention,
        waitingOnClient: facets.data.waitingOnClient,
        inProgress: facets.data.statusCounts.in_progress,
        complete: complete.data?.statusCounts.complete ?? facets.data.statusCounts.complete,
      }
    : null;
  const items = jobs.data ? attentionItems(jobs.data.items) : [];

  return (
    <>
      <div className={styles.title}>
        <div>
          <h1>
            {greeting(hour)}, {firstName(me.user.displayName)}
          </h1>
          <p className={styles.finding} aria-live="polite">
            {counts ? (
              <>
                <b>
                  {counts.needAttention === 1 ? "1 job needs attention" : `${counts.needAttention} jobs need attention`}
                </b>
                {findingText(counts).slice(findingText(counts).indexOf(" · "))}
              </>
            ) : (
              "Loading your jobs…"
            )}
          </p>
        </div>
      </div>
      <div className={styles.grid}>
        <div className={styles.mods}>
          <Link href="/subdivisions" className={styles.mod} aria-label="Open Subdivision Tracker">
            <span className={cx(styles.icon, styles.orange)}>
              <Icons.map width={20} height={20} />
            </span>
            <span className={styles.go}>Open →</span>
            <h2>Subdivision Tracker</h2>
            <p>Every subdivision job from fee proposal to registration: steps, conditions, files, clients.</p>
            {counts && (
              <div className={styles.stats}>
                <div>
                  <b>{counts.inProgress}</b>in progress
                </div>
                <div>
                  <b className={counts.needAttention > 0 ? styles.bad : undefined}>{counts.needAttention}</b>need
                  attention
                </div>
                <div>
                  <b>{counts.waitingOnClient}</b>waiting on client
                </div>
                <div>
                  <b>{counts.complete}</b>complete
                </div>
              </div>
            )}
          </Link>
          {canUsers && (
            <Link href="/admin/users" className={styles.mod} aria-label="Open Users">
              <span className={cx(styles.icon, styles.blue)}>
                <Icons.people width={20} height={20} />
              </span>
              <span className={styles.go}>Open →</span>
              <h2>Users</h2>
              <p>Who can sign in and what they may do: roles, disabled accounts, the last admin.</p>
            </Link>
          )}
          {canAudit && (
            <Link href="/admin/audit" className={styles.mod} aria-label="Open Audit trail">
              <span className={cx(styles.icon, styles.grey)}>
                <Icons.shield width={20} height={20} />
              </span>
              <span className={styles.go}>Open →</span>
              <h2>Audit trail</h2>
              <p>Every change, newest first: who, what, which job, and what it was before.</p>
            </Link>
          )}
          {canTeams && (
            <Link href="/admin/teams" className={styles.mod} aria-label="Open Teams">
              <span className={cx(styles.icon, styles.blue)}>
                <Icons.teams width={20} height={20} />
              </span>
              <span className={styles.go}>Open →</span>
              <h2>Teams</h2>
              <p>The Microsoft Teams integration: the team, the Fee Proposals channel, the switches.</p>
            </Link>
          )}
        </div>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Needs you</h2>
            <span className={styles.meta}>Subdivision Tracker</span>
          </div>
          {jobs.isPending ? (
            <p className={styles.empty}>Loading…</p>
          ) : items.length === 0 ? (
            <p className={styles.empty}>Nothing needs your attention right now.</p>
          ) : (
            <ul className={styles.list}>
              {items.map(({ job, level, text }) => (
                <li key={job.id}>
                  <span className={cx(styles.dot, level === "bad" ? styles.bad : styles.warn)} aria-hidden="true" />
                  <div>
                    <div className={styles.itemTitle}>
                      {job.jobNumber} · {text}
                    </div>
                    <div className={styles.itemSub}>
                      {job.address}
                      {job.nextActions[0] ? ` · ${job.nextActions[0].number} ${job.nextActions[0].title}` : ""}
                    </div>
                  </div>
                  <Link href={`/jobs/${job.id}`}>Open</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
