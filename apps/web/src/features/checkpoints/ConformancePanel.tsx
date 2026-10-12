"use client";
import { PROBLEM_TYPES, type CheckpointState, type FileMeta, type JobDetail } from "@kr/contracts";
import type { ConformancePanel as ConformancePanelDefinition } from "@kr/workflow";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ApiProblem } from "@/lib/api";
import { cx } from "@/lib/cx";
import { FileRows } from "./FileRows";
import { Folder, FolderHeader } from "./Folder";
import { conformanceNotStartedText, conformanceUnreadableText, fileCountText } from "./messages";
import { PanelBox } from "./PanelBox";
import { SlotZone, type SlotZoneProps } from "./SlotZone";
import { filesInSlot, isReadable } from "./slotFiles";
import { followUpOf, useFollowedOperation } from "./useFollowedOperation";
import { refreshJob } from "./refreshJob";
import { useResumedOperation } from "./useResumedOperation";
import { useStartConformanceReading } from "./useStartConformanceReading";
import styles from "./Conformance.module.css";

export interface ConformancePanelProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly panel: ConformancePanelDefinition;
}

/** What a failed reading calls its file when this page did not start it (after a reload) and so does not know which PDF it was. */
const RESUMED_FILE_NAME = "The Conformance Notification";

/**
 * What the zone is following: the conformance read by id (started by hand, or returned by an upload with scanning off), or the
 * file.scan of an upload, whose result names the read the worker queued once the scan passed.
 */
interface Reading {
  readonly fileName: string;
  readonly readOperationId: string | null;
  readonly scanOperationId: string | null;
}

interface Notice {
  readonly text: string;
  /** A date was found; false is a problem the person must act on ("Enter the conformed date below"). */
  readonly ok: boolean;
}

/**
 * 4.2 WAPC Application Conformed (§5.5 `conformance`, §10.1): the "Conformance Notification" folder and its PDF-only zone.
 * Uploading a PDF starts a read on the server (the zone says "Reading the conformed date…" while it runs, scan included);
 * "Read conformed date again" / "Read date from <file>" start one by hand. The result message shows under the zone and the job is refreshed.
 */
export function ConformancePanel({ job, checkpoint, panel }: ConformancePanelProps) {
  const { slot } = panel;
  const files = filesInSlot(checkpoint.files, slot.key);
  const pdfs = files.filter((file) => file.kind === "pdf");
  const start = useStartConformanceReading(job.id);
  const [reading, setReading] = useState<Reading | null>(null);
  const [problem, setProblem] = useState<Notice | null>(null);
  const scan = useFollowedOperation(reading?.scanOperationId ?? null);
  const settled = (op: { status: string } | undefined) => op?.status === "succeeded" || op?.status === "failed";
  // A scan that has not settled is still "reading" (the read follows it); one that queued no read (infected) ends the wait.
  const queryClient = useQueryClient();
  // A reading the job already has queued or running (after a reload, or started in another tab) is followed like our own.
  const resumed = useResumedOperation(job, "conformance.read", start.isPending || reading !== null);
  const readOperationId = reading?.readOperationId ?? followUpOf(scan) ?? resumed;
  const operation = useFollowedOperation(readOperationId);
  const running =
    start.isPending ||
    (reading?.scanOperationId != null && !settled(scan)) ||
    (readOperationId !== null && !settled(operation));
  const canRead = job.capabilities.includes("conformance.read");

  const notice = ((): Notice | null => {
    // A refusal because a reading is already running gives way to that reading once the job lists it.
    if (problem && resumed === null) return problem;
    if (!operation) return null;
    if (operation.status === "failed") {
      return { text: conformanceUnreadableText(reading?.fileName ?? RESUMED_FILE_NAME), ok: false };
    }
    if (operation.status === "succeeded" && operation.result && "found" in operation.result)
      return { text: operation.result.message, ok: operation.result.found };
    return null;
  })();

  function follow(started: { id: string }, fileName: string) {
    setProblem(null);
    setReading({ fileName, readOperationId: started.id, scanOperationId: null });
  }

  const onUploaded: NonNullable<SlotZoneProps["onUploaded"]> = (stored) => {
    const started = stored.findLast((result) => result.operation?.type === "conformance.read");
    if (started?.operation) {
      follow(started.operation, started.file.name);
      return;
    }
    // With scanning on the upload names only its scan; the scan's result names the read the worker queued after it.
    const scanning = stored.findLast((result) => result.operation?.type === "file.scan" && result.file.kind === "pdf");
    if (scanning?.operation) {
      setProblem(null);
      setReading({ fileName: scanning.file.name, readOperationId: null, scanOperationId: scanning.operation.id });
    } else setReading(null);
  };

  function read(file: FileMeta) {
    setProblem(null);
    start.mutate(file.id, {
      onSuccess: (started) => {
        follow(started, file.name);
      },
      onError: (error) => {
        setReading(null);
        const refused = error instanceof ApiProblem && error.status === 409;
        // "Already being read" is the server's own answer (the job now lists that reading, so the page follows it); any
        // other 409 is a file that is not ready.
        const inProgress = refused && error.type === PROBLEM_TYPES.conflict && error.detail !== undefined;
        setProblem({
          text: inProgress
            ? error.detail
            : conformanceNotStartedText(file.name, refused, error instanceof ApiProblem ? error.requestId : undefined),
          ok: false,
        });
        if (refused) void refreshJob(queryClient);
      },
    });
  }

  return (
    <PanelBox>
      <Folder>
        <FolderHeader title={slot.title} count={fileCountText(files.length, "not received yet")} />
        <FileRows jobId={job.id} checkpointKey={checkpoint.key} files={files} />
        <SlotZone
          job={job}
          checkpointKey={checkpoint.key}
          slot={slot}
          label={running ? "Reading the conformed date…" : undefined}
          onUploaded={onUploaded}
        />
        {canRead && pdfs.length > 0 && (
          <div className={styles.row}>
            {pdfs.map((file) => (
              <Button
                key={file.id}
                small
                disabled={running || !isReadable(file)}
                onClick={() => {
                  read(file);
                }}
              >
                {pdfs.length > 1 ? `Read date from ${file.name}` : "Read conformed date again"}
              </Button>
            ))}
          </div>
        )}
        <div role="status" className={cx(styles.msg, notice?.ok === true && styles.ok)}>
          {notice?.text}
        </div>
      </Folder>
    </PanelBox>
  );
}
