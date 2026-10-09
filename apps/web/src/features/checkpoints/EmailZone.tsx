"use client";
import type { JobDetail } from "@kr/contracts";
import type { SlotDefinition } from "@kr/workflow";
import { useEffect, useEffectEvent, useRef, useState, type ChangeEvent } from "react";
import { ApiProblem } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatMegabytes } from "@/lib/format";
import { useSession } from "@/lib/session";
import { NOTHING_TO_ADD, notAnEmailText, pasteFailedText } from "./messages";
import { usePasteEmail } from "./usePasteEmail";
import { useUploadFiles } from "./useUploadFiles";
import styles from "./EmailZone.module.css";

export interface EmailZoneProps {
  readonly job: JobDetail;
  readonly checkpointKey: string;
  readonly slot: SlotDefinition;
}

const EMAIL_FILE = /\.(msg|eml)$/i;

/**
 * The drop zone of 4.3 (§5.5 `emails`): an Outlook message dragged out of Outlook, a chosen .msg / .eml file, or plain text
 * dropped without files (pasted as an email). Other files are refused with the emails wording. Renders nothing without
 * `emails.add`.
 */
export function EmailZone({ job, checkpointKey, slot }: EmailZoneProps) {
  const { uploadMaxBytes } = useSession();
  const { upload, busy: uploading, progress, errors } = useUploadFiles({ jobId: job.id, checkpointKey, slot });
  const paste = usePasteEmail(job.id, checkpointKey);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [over, setOver] = useState(false);
  const zone = useRef<HTMLLabelElement>(null);
  const busy = uploading || paste.isPending;
  const allowed = job.capabilities.includes("emails.add");

  function receive(files: readonly File[], text: string) {
    if (busy) return;
    const refused: string[] = [];
    const emails: File[] = [];
    for (const file of files) {
      if (!EMAIL_FILE.test(file.name)) refused.push(notAnEmailText(file.name));
      else if (file.size > uploadMaxBytes)
        refused.push(`${file.name} is larger than ${formatMegabytes(uploadMaxBytes)} MB`);
      else emails.push(file);
    }
    if (files.length === 0 && text === "") refused.push(NOTHING_TO_ADD);
    setProblems(refused);
    if (emails.length > 0) void upload(emails);
    if (files.length === 0 && text !== "") {
      paste.mutate(text, {
        onError: (error) => {
          setProblems([pasteFailedText(error instanceof ApiProblem ? error.requestId : undefined)]);
        },
      });
    }
  }
  const dragOver = useEffectEvent((event: DragEvent) => {
    if (busy) return;
    event.preventDefault();
    setOver(true);
  });
  const drop = useEffectEvent((event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const transfer = event.dataTransfer;
    if (transfer) receive([...transfer.files], transfer.getData("text/plain").trim());
  });
  useEffect(() => {
    const element = zone.current;
    if (!element) return;
    const leave = () => {
      setOver(false);
    };
    element.addEventListener("dragover", dragOver);
    element.addEventListener("dragleave", leave);
    element.addEventListener("drop", drop);
    return () => {
      element.removeEventListener("dragover", dragOver);
      element.removeEventListener("dragleave", leave);
      element.removeEventListener("drop", drop);
    };
  }, [allowed]);

  if (!allowed) return null;
  function onChange(event: ChangeEvent<HTMLInputElement>) {
    receive([...(event.target.files ?? [])], "");
    event.target.value = ""; // choosing the same file again must fire a change
  }
  const lines = [...problems, ...errors];
  return (
    <div>
      <label ref={zone} className={cx(styles.drop, over && styles.over, busy && styles.busy)}>
        <input className={styles.input} type="file" multiple accept=".msg,.eml" disabled={busy} onChange={onChange} />
        <b role="status">{busy ? "Saving email…" : slot.dropLabel}</b>
        <span>{slot.dropHint}</span>
      </label>
      {progress && (
        <div className={styles.status}>
          <progress aria-label={`Uploading ${progress.name}`} value={progress.fraction} max={1} />
          <span aria-hidden="true">
            {progress.name} – {Math.round(progress.fraction * 100)}%
          </span>
        </div>
      )}
      <ul className={styles.errors} aria-live="polite">
        {lines.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
