"use client";
import type { CheckpointState } from "@kr/contracts";
import { formatInstantShort, type ApprovalPanel } from "@kr/workflow";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { ApiProblem, draftKey, useDraft } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES } from "@/lib/messages";
import { useSession } from "@/lib/session";
import { declineNeedsCommentText } from "./messages";
import { useRecordDecision, type DecisionVars } from "./useRecordDecision";
import decision from "./Decision.module.css";
import styles from "./Response.module.css";

export interface DecisionAreaProps {
  readonly jobId: string;
  readonly checkpoint: CheckpointState;
  readonly panel: ApprovalPanel;
  /** `checkpoint.decision.record` */
  readonly canRecord: boolean;
}

interface Draft {
  readonly value: DecisionVars["value"];
  readonly comment: string;
  readonly error: string | null;
}

interface DecisionFormProps {
  readonly panel: ApprovalPanel;
  readonly draft: Draft;
  readonly busy: boolean;
  readonly onChange: (draft: Draft) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** "Approve the fee proposal" / "Decline the quote": the comment box (focused when it opens), Confirm and Cancel. */
function DecisionForm({ panel, draft, busy, onChange, onConfirm, onCancel }: DecisionFormProps) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const declining = draft.value === "declined";
  useEffect(() => {
    box.current?.focus();
  }, []);
  useEffect(() => {
    if (draft.error) box.current?.focus();
  }, [draft.error]);
  return (
    <div className={decision.form}>
      <label htmlFor={id} className={decision.formTitle}>
        {declining ? "Decline" : panel.yesLabel} the {panel.noun}
      </label>
      <Textarea
        id={id}
        ref={box}
        rows={2}
        maxLength={2000}
        placeholder={declining ? "Reason for declining (required)" : "Comment (optional)"}
        aria-invalid={draft.error ? true : undefined}
        aria-describedby={draft.error ? `${id}-error` : undefined}
        value={draft.comment}
        onChange={(event) => {
          onChange({ ...draft, comment: event.target.value, error: null });
        }}
      />
      {draft.error && (
        <div id={`${id}-error`} className={styles.msg} role="alert">
          {draft.error}
        </div>
      )}
      <div className={styles.row}>
        <Button small variant="primary" disabled={busy} onClick={onConfirm}>
          {declining ? "Confirm decline" : panel.confirmLabel}
        </Button>
        <Button small disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The decision area of an approval panel (§5.5): the green "<Yes> <noun>" and red "Decline <noun>" buttons, the inline form
 * with its comment (a decline needs one, and focus returns to the box when it is missing), and once decided the result box
 * "Client approved the WAPC proposal 28 Sep 2026" with the comment and Change, which re-opens the form pre-filled. A decision
 * does not change the checkpoint's status.
 */
export function DecisionArea({ jobId, checkpoint, panel, canRecord }: DecisionAreaProps) {
  const record = useRecordDecision(jobId, checkpoint.key);
  const [draft, setDraft] = useState<Draft | null>(null);
  const { decision: result } = checkpoint;

  // A comment being written is kept when the session ends and the form opens again with it after sign-in (§3.1, §15). The
  // decision (accepted / declined) rides along as the draft's `base`.
  const { user } = useSession();
  const banners = useBanners();
  useDraft(
    canRecord ? draftKey(user.id, jobId, checkpoint.key, "decision") : undefined,
    () => (draft?.comment.trim() ? { text: draft.comment, base: draft.value } : null),
    (stored) => {
      if (!stored.text.trim()) return;
      setDraft({ value: stored.base === "declined" ? "declined" : "accepted", comment: stored.text, error: null });
      banners.show("draft-restored", MESSAGES.draftRestored);
    },
  );

  async function confirm(current: Draft) {
    const comment = current.comment.trim();
    if (current.value === "declined" && comment === "") {
      setDraft({ ...current, error: declineNeedsCommentText(panel.noun) });
      return;
    }
    try {
      await record.mutateAsync({ value: current.value, comment });
      setDraft(null);
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 400) {
        setDraft({
          ...current,
          error: error.errors.find((e) => e.path === "comment")?.message ?? declineNeedsCommentText(panel.noun),
        });
      }
    }
  }

  return (
    <div className={decision.dec}>
      <div className={styles.label}>{panel.decisionLabel}</div>
      {draft ? (
        <DecisionForm
          panel={panel}
          draft={draft}
          busy={record.isPending}
          onChange={setDraft}
          onConfirm={() => void confirm(draft)}
          onCancel={() => {
            setDraft(null);
          }}
        />
      ) : result ? (
        <div className={styles.result} data-v={result.value}>
          <div className={styles.row}>
            <b>
              Client {result.value === "accepted" ? panel.yesPast : "declined"} the {panel.noun}
            </b>
            <span className={styles.date}>{formatInstantShort(result.at)}</span>
            {canRecord && (
              <Button
                small
                className={styles.change}
                onClick={() => {
                  setDraft({ value: result.value, comment: result.comment, error: null });
                }}
              >
                Change
              </Button>
            )}
          </div>
          {result.comment && <div className={styles.comment}>“{result.comment}”</div>}
        </div>
      ) : (
        <div className={styles.row}>
          <Button
            className={styles.accept}
            disabled={!canRecord}
            onClick={() => {
              setDraft({ value: "accepted", comment: "", error: null });
            }}
          >
            {panel.yesLabel} {panel.noun}
          </Button>
          <Button
            className={styles.decline}
            disabled={!canRecord}
            onClick={() => {
              setDraft({ value: "declined", comment: "", error: null });
            }}
          >
            Decline {panel.noun}
          </Button>
        </div>
      )}
    </div>
  );
}
