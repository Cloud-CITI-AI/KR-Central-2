import type { OperationRow } from "@kr/db";
import { describe, expect, it, vi } from "vitest";
import { GENERIC_FAILURE, safeFailure, toOperation } from "./operation-view.js";

const base: OperationRow = {
  id: "5b0c3a3e-1d3f-4c58-9d0e-8d6b0b2f7a11",
  job_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  type: "conditions.extract",
  status: "queued",
  payload: {},
  result: null,
  error_code: null,
  error_message: null,
  attempts: 0,
  max_attempts: 3,
  run_after: new Date("2026-03-02T01:00:00Z"),
  locked_by: null,
  locked_until: null,
  created_by: null,
  created_at: new Date("2026-03-02T01:00:00Z"),
  started_at: null,
  completed_at: null,
};

describe("toOperation", () => {
  it("maps a queued operation without result or error", () => {
    expect(toOperation(base)).toEqual({
      id: base.id,
      jobId: base.job_id,
      type: "conditions.extract",
      status: "queued",
      createdAt: "2026-03-02T01:00:00.000Z",
      completedAt: null,
      result: null,
      error: null,
    });
  });

  it("returns a succeeded result that matches its type and nothing else", () => {
    const result = {
      conditionsCount: 2,
      guessedNumbers: [2],
      approvalDate: "2026-01-05",
      approvalExpiry: null,
      message: null,
    };
    const done = { ...base, status: "succeeded" as const, completed_at: new Date("2026-03-02T01:00:05Z"), result };
    expect(toOperation(done)).toMatchObject({ status: "succeeded", completedAt: "2026-03-02T01:00:05.000Z", result });
    const unreadable = vi.fn();
    expect(toOperation({ ...done, result: { date: "2026-01-05" } }, unreadable).result).toBeNull();
    expect(unreadable).toHaveBeenCalledOnce();
    expect(toOperation({ ...done, type: "file.scan", result }).result).toBeNull();
    expect(toOperation({ ...done, result: null }, unreadable).result).toBeNull();
    expect(unreadable).toHaveBeenCalledOnce();
  });

  it("returns a file.scan result with the follow-up task, reading an older row without one as none", () => {
    const done = { ...base, type: "file.scan" as const, status: "succeeded" as const, completed_at: base.created_at };
    const followUpOperationId = "7d444840-9dc0-41b4-a5c2-3a8e7f1d2b9c";
    expect(toOperation({ ...done, result: { scanStatus: "clean", followUpOperationId } }).result).toEqual({
      scanStatus: "clean",
      followUpOperationId,
    });
    expect(toOperation({ ...done, result: { scanStatus: "gone" } }).result).toEqual({
      scanStatus: "gone",
      followUpOperationId: null,
    });
    const unreadable = vi.fn();
    expect(toOperation({ ...done, result: { scanStatus: "pending" } }, unreadable).result).toBeNull();
    expect(toOperation({ ...done, result: ["clean"] }, unreadable).result).toBeNull();
    expect(unreadable).toHaveBeenCalledTimes(2);
    expect(toOperation({ ...done, type: "email.parse", result: { scanStatus: "clean" } }).result).toBeNull();
  });

  it("shows an error only on a failed operation, not on a retry waiting in the queue", () => {
    const retry = { ...base, error_code: "timeout", error_message: "x", attempts: 1 };
    expect(toOperation(retry).error).toBeNull();
    expect(toOperation({ ...retry, status: "failed" }).error).toEqual({
      code: "timeout",
      message: "Reading the document took too long. Try again.",
    });
  });
});

describe("safeFailure", () => {
  it("uses the API's own message for a known code, whatever the worker stored", () => {
    expect(safeFailure("unreadable_pdf", "PDF.js: Invalid XRef stream at /app/node_modules/x.js:1")).toEqual({
      code: "unreadable_pdf",
      message: "The PDF could not be read. It may be damaged or a scanned image.",
    });
  });

  it("passes a plain message for an unknown code", () => {
    expect(safeFailure("no_text", "No readable text was found in this PDF.")).toEqual({
      code: "no_text",
      message: "No readable text was found in this PDF.",
    });
  });

  it.each([
    "Error: connect ECONNREFUSED 10.0.0.4:5432",
    "at Object.run (/app/dist/handler.js:12:3)",
    "select * from files where id = 1",
    "Request to https://api.example.test/v1 failed",
    "line one\nline two",
    "x".repeat(301),
    "",
  ])("replaces text that looks like an internal error: %j", (message) => {
    expect(safeFailure("boom", message)).toEqual({ code: "boom", message: GENERIC_FAILURE });
  });

  it("replaces a malformed code and a missing message", () => {
    expect(safeFailure("Bad Code!", null)).toEqual({ code: "failed", message: GENERIC_FAILURE });
    expect(safeFailure(null, "Nothing found.")).toEqual({ code: "failed", message: "Nothing found." });
  });
});
