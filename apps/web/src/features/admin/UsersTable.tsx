"use client";
import type { User } from "@kr/contracts";
import { cx } from "@/lib/cx";
import styles from "./Admin.module.css";
import table from "./AdminTable.module.css";
import { formatPerthDateTime, ROLE_LABELS } from "./format";

export interface UsersTableProps {
  readonly users: readonly User[];
  /** The signed-in person, marked "(you)". */
  readonly currentUserId: string;
}

/** Users as a table (§9.1): name, email, role, guest/member, status, last sign-in. */
export function UsersTable({ users, currentUserId }: UsersTableProps) {
  return (
    <div className={table.tableWrap}>
      <table className={table.table}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Account</th>
            <th scope="col">Status</th>
            <th scope="col">Last sign-in</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const own = user.id === currentUserId;
            return (
              <tr key={user.id}>
                <td data-label="Name" className={table.strong}>
                  {user.displayName}
                  {own && <span className={styles.muted}> (you)</span>}
                </td>
                <td data-label="Email">{user.email ?? "–"}</td>
                <td data-label="Role">{ROLE_LABELS[user.role]}</td>
                <td data-label="Account">{user.isGuest ? "Guest" : "Member"}</td>
                <td data-label="Status">
                  <span className={cx(table.chip, user.status === "active" ? table.active : table.disabled)}>
                    {user.status === "active" ? "Active" : "Disabled"}
                  </span>
                </td>
                <td data-label="Last sign-in">
                  {user.lastSignInAt ? formatPerthDateTime(user.lastSignInAt) : "Never"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
