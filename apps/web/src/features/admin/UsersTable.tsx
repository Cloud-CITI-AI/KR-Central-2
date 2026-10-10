"use client";
import type { GlobalRole, User } from "@kr/contracts";
import { GLOBAL_ROLES } from "@kr/contracts/capabilities";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { cx } from "@/lib/cx";
import styles from "./Admin.module.css";
import table from "./AdminTable.module.css";
import { formatPerthDateTime, ROLE_LABELS } from "./format";

export interface UsersTableProps {
  readonly users: readonly User[];
  /** The signed-in person: their own row is read-only (§9.1). */
  readonly currentUserId: string;
  readonly onChangeRole: (user: User, role: GlobalRole) => void;
  readonly onToggleStatus: (user: User) => void;
}

/** Users as a table (§9.1): name, email, role, guest/member, status, last sign-in, and the actions. */
export function UsersTable({ users, currentUserId, onChangeRole, onToggleStatus }: UsersTableProps) {
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
            <th scope="col">Actions</th>
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
                <td data-label="Role">
                  {own ? (
                    ROLE_LABELS[user.role]
                  ) : (
                    <Select
                      aria-label={`Role for ${user.displayName}`}
                      value={user.role}
                      onChange={(event) => {
                        onChangeRole(user, event.target.value as GlobalRole);
                      }}
                    >
                      {GLOBAL_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </Select>
                  )}
                </td>
                <td data-label="Account">{user.isGuest ? "Guest" : "Member"}</td>
                <td data-label="Status">
                  <span className={cx(table.chip, user.status === "active" ? table.active : table.disabled)}>
                    {user.status === "active" ? "Active" : "Disabled"}
                  </span>
                </td>
                <td data-label="Last sign-in">
                  {user.lastSignInAt ? formatPerthDateTime(user.lastSignInAt) : "Never"}
                </td>
                <td data-label="Actions">
                  {own ? (
                    <span className={styles.muted}>Your own role and status can't be changed.</span>
                  ) : (
                    <Button
                      small
                      aria-label={`${user.status === "active" ? "Disable" : "Enable"} ${user.displayName}`}
                      onClick={() => {
                        onToggleStatus(user);
                      }}
                    >
                      {user.status === "active" ? "Disable" : "Enable"}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
