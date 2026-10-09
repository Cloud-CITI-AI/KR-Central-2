"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { api, ApiProblem } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES } from "@/lib/messages";
import { navigation } from "@/lib/navigation";
import styles from "./Admin.module.css";

/** The API's 403 detail when an admin session has no multi-factor evidence (§3.1). */
export const MFA_REQUIRED = "Multi-factor sign-in required";
/** The API's 409 detail when a change would leave no active admin (§9.1). */
export const LAST_ADMIN = "There must be at least one active admin.";

export interface ProblemText {
  readonly kind: "mfa" | "last-admin" | "stale" | "other";
  readonly title: string;
  readonly text: string;
  readonly requestId: string | undefined;
}

/** What to tell the person about a failed admin call: the MFA 403, the last-admin 409, a stale 412, or anything else. */
export function describeProblem(error: unknown): ProblemText {
  if (!(error instanceof ApiProblem)) {
    return {
      kind: "other",
      title: "Something went wrong",
      text: "The request didn't work – please try again.",
      requestId: undefined,
    };
  }
  const requestId = error.requestId || undefined;
  if (error.status === 403 && error.detail?.includes(MFA_REQUIRED)) {
    return {
      kind: "mfa",
      title: MFA_REQUIRED,
      text: "The admin pages need a sign-in that used multi-factor authentication. Sign out, then sign in again and complete the multi-factor prompt.",
      requestId,
    };
  }
  if (error.status === 409) {
    return { kind: "last-admin", title: "That change isn't allowed", text: error.detail ?? LAST_ADMIN, requestId };
  }
  if (error.status === 412) return { kind: "stale", title: "Out of date", text: MESSAGES.stale, requestId };
  if (error.status === 403) {
    return { kind: "other", title: "You don't have access", text: error.detail ?? "You can't do that.", requestId };
  }
  return {
    kind: "other",
    title: "Something went wrong",
    text: error.detail ?? "The request didn't work – please try again.",
    requestId,
  };
}

export interface ProblemNoticeProps {
  readonly error: unknown;
  /** Offered for problems another attempt can fix (not the MFA one, which needs a new sign-in). */
  readonly onRetry?: () => void;
}

/** A failed admin call as a red alert with the request id (EH-1); the MFA problem offers "sign out and in again". */
export function ProblemNotice({ error, onRetry }: ProblemNoticeProps) {
  const { show } = useBanners();
  const [busy, setBusy] = useState(false);
  const { kind, title, text, requestId } = describeProblem(error);

  async function signOutAndIn() {
    setBusy(true);
    try {
      navigation.assign((await api("logout")).redirectTo);
    } catch (failure) {
      setBusy(false);
      const id = failure instanceof ApiProblem && failure.requestId ? ` (Request ID: ${failure.requestId})` : "";
      show("sign-out-failed", `${MESSAGES.signOutFailed}${id}`);
    }
  }

  return (
    <div className={styles.problem} role="alert">
      <strong>{title}</strong>
      <p>{text}</p>
      {requestId && <p className={styles.muted}>Request ID: {requestId}</p>}
      <div className={styles.problemActions}>
        {kind === "mfa" ? (
          <Button
            small
            disabled={busy}
            onClick={() => {
              void signOutAndIn();
            }}
          >
            Sign out and sign in again
          </Button>
        ) : (
          onRetry && (
            <Button small onClick={onRetry}>
              Try again
            </Button>
          )
        )}
      </div>
    </div>
  );
}
