import { describe, expect, it } from "vitest";
import { planJobUpdate, type CurrentJob } from "./job-update.js";

const current: CurrentJob = {
  job_number: "S-0001",
  address: "1 Example Street, Testville",
  client_name: "Sample Developments Pty Ltd",
  subdivision_type: "Freehold",
  approval_date: null,
  approval_expiry: null,
  conformed_date: null,
  conformed_method: null,
  conformed_file_id: null,
  conformed_stamp_text: null,
  outcome_date: null,
};
const read: CurrentJob = {
  ...current,
  conformed_date: "2026-02-10",
  conformed_method: "stamp_annotation",
  conformed_file_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  conformed_stamp_text: "Conformed 10 Feb 2026",
  outcome_date: "2026-05-11",
};

describe("planJobUpdate", () => {
  it("returns only the columns that change, with an audit diff in API field names", () => {
    const plan = planJobUpdate(current, {
      address: "2 New Road, Testville",
      clientName: null,
      subdivisionType: "Freehold",
      approvalDate: "2026-03-02",
      approvalExpiry: "2029-03-02",
    });
    expect(plan.set).toEqual({
      address: "2 New Road, Testville",
      client_name: null,
      approval_date: "2026-03-02",
      approval_expiry: "2029-03-02",
    });
    expect(plan.changes).toEqual({
      address: { from: "1 Example Street, Testville", to: "2 New Road, Testville" },
      clientName: { from: "Sample Developments Pty Ltd", to: null },
      approvalDate: { from: null, to: "2026-03-02" },
      approvalExpiry: { from: null, to: "2029-03-02" },
    });
    expect(plan.isNoOp).toBe(false);
  });

  it("is a no-op when every sent value equals the stored one", () => {
    const plan = planJobUpdate(current, {
      jobNumber: "S-0001",
      clientName: "Sample Developments Pty Ltd",
      approvalDate: null,
    });
    expect(plan).toEqual({ set: {}, changes: {}, isNoOp: true });
  });

  it("treats a changed job number case as a change", () => {
    expect(planJobUpdate(current, { jobNumber: "s-0001" }).set).toEqual({ job_number: "s-0001" });
  });

  it("records a manual conformed date with outcome = conformed + 90 days", () => {
    const plan = planJobUpdate(current, { conformedDate: "2026-02-10" });
    expect(plan.set).toEqual({ conformed_date: "2026-02-10", conformed_method: "manual", outcome_date: "2026-05-11" });
    expect(plan.changes).toEqual({
      conformedDate: { from: null, to: "2026-02-10" },
      conformedMethod: { from: null, to: "manual" },
      outcomeDate: { from: null, to: "2026-05-11" },
    });
  });

  it("replaces an earlier reading: method manual, file and stamp text forgotten, outcome reset", () => {
    const plan = planJobUpdate(read, { conformedDate: "2026-03-01" });
    expect(plan.set).toEqual({
      conformed_date: "2026-03-01",
      conformed_method: "manual",
      conformed_file_id: null,
      conformed_stamp_text: null,
      outcome_date: "2026-05-30",
    });
    expect(Object.keys(plan.changes)).toEqual([
      "conformedDate",
      "conformedMethod",
      "conformedFileId",
      "conformedStampText",
      "outcomeDate",
    ]);
  });

  it("keeps an outcome date that is sent with the conformed date, even null", () => {
    expect(planJobUpdate(current, { conformedDate: "2026-02-10", outcomeDate: "2026-06-01" }).set).toMatchObject({
      conformed_date: "2026-02-10",
      outcome_date: "2026-06-01",
    });
    expect(planJobUpdate(read, { conformedDate: "2026-03-01", outcomeDate: null }).set.outcome_date).toBeNull();
  });

  it("clears the conformed date and its provenance but leaves the outcome date alone", () => {
    const plan = planJobUpdate(read, { conformedDate: null });
    expect(plan.set).toEqual({
      conformed_date: null,
      conformed_method: null,
      conformed_file_id: null,
      conformed_stamp_text: null,
    });
    expect(plan.set).not.toHaveProperty("outcome_date");
  });

  it("does not turn a read conformed date into a manual one when the same date is sent again", () => {
    expect(planJobUpdate(read, { conformedDate: "2026-02-10" }).isNoOp).toBe(true);
    expect(planJobUpdate(read, { conformedDate: "2026-02-10", outcomeDate: "2026-06-01" }).set).toEqual({
      outcome_date: "2026-06-01",
    });
  });

  it("changes the outcome date on its own (a deferral) and resets it with the +90 value", () => {
    expect(planJobUpdate(read, { outcomeDate: "2026-07-01" }).set).toEqual({ outcome_date: "2026-07-01" });
    expect(planJobUpdate(read, { outcomeDate: "2026-05-11" }).isNoOp).toBe(true);
  });
});
