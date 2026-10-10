/**
 * What an updateJob request changes (PRODUCT_SPEC §5.1, §5.2, DATA_MODEL §6). Pure: compares the request with the
 * current row and returns only the columns that change, plus the audit diff (API field names, {from, to}).
 *
 * Manual conformed date: setting `conformedDate` records method "manual", forgets the file and stamp text of an earlier
 * reading, and sets the outcome date to conformed + 90 days (R10) unless the request also sends `outcomeDate`. Clearing
 * `conformedDate` clears the outcome date the same way (a deferral typed meanwhile goes with it; send `outcomeDate` to keep one).
 */
import type { UpdateJobRequest } from "@kr/contracts";
import type { AuditChanges, JobRow } from "@kr/db";
import { outcomeDateFor } from "@kr/workflow";
import type { z } from "zod";

type UpdateBody = z.output<typeof UpdateJobRequest>;

export type JobUpdateColumns = Partial<
  Pick<
    JobRow,
    | "job_number"
    | "address"
    | "client_name"
    | "subdivision_type"
    | "approval_date"
    | "approval_expiry"
    | "conformed_date"
    | "conformed_method"
    | "conformed_file_id"
    | "conformed_stamp_text"
    | "outcome_date"
  >
>;

export type CurrentJob = Required<Pick<JobRow, keyof JobUpdateColumns>>;

export interface JobUpdatePlan {
  readonly set: JobUpdateColumns;
  /** Empty when the request changes nothing. */
  readonly changes: AuditChanges;
  readonly isNoOp: boolean;
}

export function planJobUpdate(current: CurrentJob, body: UpdateBody): JobUpdatePlan {
  const set: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const apply = (field: string, column: keyof JobUpdateColumns, to: string | null | undefined) => {
    if (to === undefined || to === current[column]) return;
    set[column] = to;
    changes[field] = { from: current[column], to };
  };

  apply("jobNumber", "job_number", body.jobNumber);
  apply("address", "address", body.address);
  apply("clientName", "client_name", body.clientName);
  apply("subdivisionType", "subdivision_type", body.subdivisionType);
  apply("approvalDate", "approval_date", body.approvalDate);
  apply("approvalExpiry", "approval_expiry", body.approvalExpiry);

  if (body.conformedDate !== undefined && body.conformedDate !== current.conformed_date) {
    apply("conformedDate", "conformed_date", body.conformedDate);
    apply("conformedMethod", "conformed_method", body.conformedDate === null ? null : "manual");
    apply("conformedFileId", "conformed_file_id", null);
    apply("conformedStampText", "conformed_stamp_text", null);
    // R10 ties the outcome date to the conformed date: set it to +90 days, and clear it with the conformed date.
    if (body.outcomeDate === undefined) {
      apply("outcomeDate", "outcome_date", body.conformedDate === null ? null : outcomeDateFor(body.conformedDate));
    }
  }
  apply("outcomeDate", "outcome_date", body.outcomeDate);

  return { set, changes, isNoOp: Object.keys(set).length === 0 };
}
