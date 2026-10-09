"use client";
import { UpdateJobRequest, type JobDetail } from "@kr/contracts";
import { SUBDIVISION_TYPES } from "@kr/workflow";
import { useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ApiProblem } from "@/lib/api";
import { duplicateJobText, JOB_DETAILS_MESSAGES } from "./messages";
import { useUpdateJob, type UpdateJobBody } from "./useUpdateJob";
import styles from "./JobDetailsDialog.module.css";

export interface JobDetailsDialogProps {
  readonly job: JobDetail;
  readonly open: boolean;
  readonly onClose: () => void;
}

/** The "Job details" dialog (§5.1): job number, address, client and subdivision type, saved with `If-Match`. */
export function JobDetailsDialog({ job, open, onClose }: JobDetailsDialogProps) {
  const update = useUpdateJob(job.id);
  const [error, setError] = useState("");

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const missing = !text("jobNumber")
      ? JOB_DETAILS_MESSAGES.jobNumber
      : !text("address")
        ? JOB_DETAILS_MESSAGES.address
        : "";
    if (missing) {
      setError(missing);
      return;
    }
    const changes: Record<string, string | null> = {};
    if (text("jobNumber") !== job.jobNumber) changes.jobNumber = text("jobNumber");
    if (text("address") !== job.address) changes.address = text("address");
    if (text("clientName") !== (job.clientName ?? "")) changes.clientName = text("clientName") || null;
    if (text("subdivisionType") !== (job.subdivisionType ?? "")) changes.subdivisionType = text("subdivisionType");
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    const parsed = UpdateJobRequest.safeParse(changes);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? JOB_DETAILS_MESSAGES.jobNumber);
      return;
    }
    setError("");
    try {
      await update.mutateAsync(parsed.data satisfies UpdateJobBody);
      onClose();
    } catch (problem) {
      if (problem instanceof ApiProblem && problem.status === 409) setError(duplicateJobText(text("jobNumber")));
      else onClose(); // the save-failed or stale banner is on the page behind the dialog
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Job details" size="small">
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Job number">
          {(c) => (
            <Input
              {...c}
              name="jobNumber"
              defaultValue={job.jobNumber}
              maxLength={32}
              autoComplete="off"
              data-autofocus
            />
          )}
        </Field>
        <Field label="Address">
          {(c) => <Input {...c} name="address" defaultValue={job.address} maxLength={200} autoComplete="off" />}
        </Field>
        <Field label="Client (optional)">
          {(c) => (
            <Input {...c} name="clientName" defaultValue={job.clientName ?? ""} maxLength={200} autoComplete="off" />
          )}
        </Field>
        <Field label="Subdivision type">
          {(c) => (
            <Select {...c} name="subdivisionType" defaultValue={job.subdivisionType ?? ""}>
              {!job.subdivisionType && <option value="">Subdivision type…</option>}
              {SUBDIVISION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={update.isPending}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
