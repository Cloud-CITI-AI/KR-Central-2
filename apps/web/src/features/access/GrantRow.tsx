import { cx } from "@/lib/cx";
import { ROLE_LABELS, STATUS_LABELS } from "./messages";
import type { Grant } from "./types";
import styles from "./GrantList.module.css";

export interface GrantRowProps {
  readonly grant: Grant;
}

/** "Name <email>", or just the email when no name was given. */
function whoText(grant: Grant): string {
  return grant.displayName ? `${grant.displayName} <${grant.email}>` : grant.email;
}

/**
 * One person on the list: name and email, job chip, role, status chip (PENDING / ACTIVE / REVOKED), the invitation
 * chip when an Entra invitation was attempted, and for an active grant the account it is bound to (§3.4), so staff
 * can spot a wrong match.
 */
export function GrantRow({ grant }: GrantRowProps) {
  return (
    <li className={styles.row}>
      <span className={styles.who}>{grant.status === "active" ? grant.email : whoText(grant)}</span>
      <span className={styles.job}>{grant.jobNumber}</span>
      <span className={styles.role}>{ROLE_LABELS[grant.role]}</span>
      <span className={styles.status} data-status={grant.status}>
        {STATUS_LABELS[grant.status]}
      </span>
      {grant.invitationStatus !== "not_sent" && (
        <span className={cx(styles.status, styles.invitation)} data-status={`invitation-${grant.invitationStatus}`}>
          {grant.invitationStatus === "sent" ? "Invitation sent" : "Invitation failed"}
        </span>
      )}
      {grant.status === "active" && (
        <span className={styles.bound}>{grant.displayName ? `Signed in as ${grant.displayName}` : "Signed in"}</span>
      )}
    </li>
  );
}
