"use client";
import type { AuditEvent as AuditEventSchema } from "@kr/contracts";
import Link from "next/link";
import type { z } from "zod";
import styles from "./Admin.module.css";
import table from "./AdminTable.module.css";
import { AuditChanges } from "./AuditChanges";
import { formatPerthDateTime } from "./format";

type AuditEvent = z.infer<typeof AuditEventSchema>;

export interface AuditTableProps {
  readonly events: readonly AuditEvent[];
}

const shortId = (id: string): string => id.slice(0, 8);

/** The audit trail as a table, newest first (§9.2): time, user, action, job, entity and the changes. */
export function AuditTable({ events }: AuditTableProps) {
  return (
    <div className={table.tableWrap}>
      <table className={table.table}>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">User</th>
            <th scope="col">Action</th>
            <th scope="col">Job</th>
            <th scope="col">Entity</th>
            <th scope="col">Changes</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td data-label="Time">{formatPerthDateTime(event.occurredAt, { seconds: true })}</td>
              <td data-label="User">{event.actor?.displayName ?? <span className={styles.muted}>System</span>}</td>
              <td data-label="Action" className={table.mono}>
                {event.action}
              </td>
              <td data-label="Job">
                {event.jobId ? (
                  <Link href={`/jobs/${event.jobId}`} className={table.mono} aria-label={`Open job ${event.jobId}`}>
                    {shortId(event.jobId)}
                  </Link>
                ) : (
                  "–"
                )}
              </td>
              <td data-label="Entity">
                {event.entityType}
                {event.entityId && <span className={`${table.mono} ${styles.muted}`}> {shortId(event.entityId)}</span>}
              </td>
              <td data-label="Changes">
                <AuditChanges changes={event.changes} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
