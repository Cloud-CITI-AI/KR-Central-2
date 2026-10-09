"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { cx } from "@/lib/cx";
import { REMOVE_FAILED, ROLE_LABELS, STATUS_LABELS } from "./messages";
import { useRevokeGrant } from "./queries";
import type { Grant } from "./types";
import styles from "./GrantList.module.css";

export interface GrantRowProps {
  readonly grant: Grant;
}

/**
 * "Name <email>", or just the email when no name was given. The name is whatever staff typed when they added the
 * person; it is not the account that signed in, so it is never labelled as that.
 */
function whoText(grant: Grant): string {
  return grant.displayName ? `${grant.displayName} <${grant.email}>` : grant.email;
}

/**
 * One person on the list: name and email, job chip, role, status chip (PENDING / ACTIVE / REVOKED), the invitation
 * chip when an Entra invitation was attempted, and × with the inline "Remove? Yes / No" confirmation for grants that are not revoked yet.
 */
export function GrantRow({ grant }: GrantRowProps) {
  const revoke = useRevokeGrant();
  const [confirming, setConfirming] = useState(false);
  const removeButton = useRef<HTMLButtonElement>(null);
  const question = useRef<HTMLSpanElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    // Asking moves focus to the safe answer (No); answering puts it back on the × that asked.
    if (confirming) question.current?.querySelector<HTMLElement>("[data-no]")?.focus();
    else if (wasConfirming.current) removeButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <li className={styles.row}>
      <span className={styles.who}>{whoText(grant)}</span>
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
      {revoke.isError && (
        <span role="alert" className={styles.failed}>
          {REMOVE_FAILED}
        </span>
      )}
      {grant.status !== "revoked" &&
        (confirming ? (
          <span ref={question} className={styles.confirm}>
            Remove?
            <Button
              small
              onClick={() => {
                setConfirming(false);
                revoke.mutate(grant);
              }}
            >
              Yes
            </Button>
            <Button
              small
              data-no
              onClick={() => {
                setConfirming(false);
              }}
            >
              No
            </Button>
          </span>
        ) : (
          <button
            ref={removeButton}
            type="button"
            className={styles.remove}
            disabled={revoke.isPending}
            onClick={() => {
              setConfirming(true);
            }}
          >
            <VisuallyHidden>Remove {grant.email}</VisuallyHidden>
            <span aria-hidden="true">×</span>
          </button>
        ))}
    </li>
  );
}
