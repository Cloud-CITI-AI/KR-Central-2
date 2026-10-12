"use client";
import type { FileMeta, JobDetail } from "@kr/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ApiProblem } from "@/lib/api";
import { cx } from "@/lib/cx";
import { refreshJob, useFollowedOperation, useResumedOperation } from "@/features/checkpoints";
import {
  DECISION_LETTER_ONLY,
  extractedText,
  extractionNotStartedText,
  extractLabel,
  READING_LETTER,
  replaceCountOf,
  replaceText,
  UNREADABLE_LETTER,
} from "./messages";
import { useStartConditionsExtraction } from "./useStartConditionsExtraction";
import styles from "./Conditions.module.css";

export interface ExtractionActionsProps {
  readonly job: JobDetail;
  /** The PDFs of the 5.0 folder. */
  readonly pdfs: readonly FileMeta[];
}

interface Line {
  readonly text: string;
  /** Nothing to act on (a count); false is a note the person should read (guessed agencies, no conditions, a failure). */
  readonly ok: boolean;
}

/** Only a clean (or unscanned-by-design) PDF can be read, and only one named "decision" (§10.2). */
const isDecisionLetter = (file: FileMeta) => /decision/i.test(file.name);
const isReadable = (file: FileMeta) => file.scanStatus === "clean" || file.scanStatus === "skipped";

/**
 * The extract buttons of the 5.0 folder (§5.5): one per PDF whose name contains "decision", the replace confirmation when
 * conditions exist already, and the result message under them. Without such a PDF the folder says the letter must be
 * named so. Extraction runs on the server as an operation; the job is refreshed when it ends.
 */
export function ExtractionActions({ job, pdfs }: ExtractionActionsProps) {
  const letters = pdfs.filter(isDecisionLetter);
  const start = useStartConditionsExtraction(job.id);
  const [confirming, setConfirming] = useState<{ file: FileMeta; count: number } | null>(null);
  /** The operation of the extraction being followed. */
  const [following, setFollowing] = useState<string | null>(null);
  const [problem, setProblem] = useState<Line | null>(null);
  const queryClient = useQueryClient();
  // A reading the job already has queued or running (after a reload, or started in another tab) is followed like our own.
  const resumed = useResumedOperation(job, "conditions.extract", start.isPending || following !== null);
  const followed = following ?? resumed;
  const operation = useFollowedOperation(followed);
  const running =
    start.isPending || (followed !== null && operation?.status !== "succeeded" && operation?.status !== "failed");
  const row = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    // Asking moves focus to the safe answer (Cancel); answering puts it back on the button that asked.
    if (confirming) row.current?.querySelector<HTMLElement>("[data-cancel]")?.focus();
    else if (wasConfirming.current) row.current?.querySelector<HTMLElement>("[data-extract]")?.focus();
    wasConfirming.current = confirming !== null;
  }, [confirming]);

  if (!job.capabilities.includes("conditions.extract")) return null;

  const lines = ((): Line[] => {
    // A refusal because a reading is already running gives way to that reading once the job lists it.
    if (problem && resumed === null) return [problem];
    if (!followed || !operation) return [];
    if (operation.status === "failed") {
      // Only a document that could not be read gets the re-save advice; a time limit, a replaced job or a missing
      // file each carry their own message from the worker.
      const reason = operation.error;
      return [
        {
          text: reason && reason.code !== "unreadable" && reason.message ? reason.message : UNREADABLE_LETTER,
          ok: false,
        },
      ];
    }
    if (operation.status === "succeeded" && operation.result && "conditionsCount" in operation.result) {
      const { conditionsCount, message } = operation.result;
      return [
        ...(conditionsCount > 0 ? [{ text: extractedText(conditionsCount), ok: true }] : []),
        ...(message ? [{ text: message, ok: false }] : []),
      ];
    }
    return [];
  })();

  function begin(file: FileMeta, replaceExisting: boolean) {
    setProblem(null);
    setConfirming(null);
    setFollowing(null);
    start.mutate(
      { fileId: file.id, replaceExisting },
      {
        onSuccess: (queued) => {
          setFollowing(queued.id);
        },
        onError: (error) => {
          const replace = error instanceof ApiProblem && error.status === 409 ? replaceCountOf(error.detail) : null;
          if (replace !== null) {
            setConfirming({ file, count: replace });
            return;
          }
          const text =
            error instanceof ApiProblem && error.status === 409 && error.detail
              ? error.detail
              : extractionNotStartedText(file.name, error instanceof ApiProblem ? error.requestId : undefined);
          setProblem({ text, ok: false });
          // "Already being read": the job now lists that reading, so the page picks it up and follows it.
          if (error instanceof ApiProblem && error.status === 409) void refreshJob(queryClient);
        },
      },
    );
  }

  function ask(file: FileMeta) {
    if (job.conditions.length > 0) setConfirming({ file, count: job.conditions.length });
    else begin(file, false);
  }

  return (
    <>
      {letters.length > 0 ? (
        <div ref={row} className={styles.row}>
          {letters.map((file) =>
            confirming?.file.id === file.id ? (
              <span
                key={file.id}
                className={styles.confirm}
                role="group"
                aria-label={`Replace the conditions with ${file.name}`}
              >
                {replaceText(confirming.count)}
                <Button
                  small
                  onClick={() => {
                    begin(file, true);
                  }}
                >
                  Replace
                </Button>
                <Button
                  small
                  data-cancel
                  onClick={() => {
                    setConfirming(null);
                  }}
                >
                  Cancel
                </Button>
              </span>
            ) : (
              <Button
                key={file.id}
                small
                variant="primary"
                disabled={running || !isReadable(file)}
                data-extract
                onClick={() => {
                  ask(file);
                }}
              >
                {running ? READING_LETTER : extractLabel(file.name, letters.length, job.conditions.length > 0)}
              </Button>
            ),
          )}
        </div>
      ) : (
        pdfs.length > 0 && <p className={cx(styles.msg, styles.ok)}>{DECISION_LETTER_ONLY}</p>
      )}
      <div role="status" className={styles.notice}>
        {lines.map(({ text, ok }) => (
          <p key={text} className={cx(styles.msg, ok && styles.ok)}>
            {text}
          </p>
        ))}
      </div>
    </>
  );
}
