import { describe, expect, it } from "vitest";
import { TaskError, UNEXPECTED_FAILURE, toFailure } from "./errors.js";

describe("toFailure", () => {
  it("keeps the code, message and retry flag of a TaskError", () => {
    const failure = toFailure(new TaskError("timeout", "Reading the document took too long.", { retryable: true }));
    expect(failure).toEqual({ code: "timeout", message: "Reading the document took too long.", retryable: true });
  });

  it("makes a TaskError permanent unless it says otherwise", () => {
    expect(toFailure(new TaskError("not_a_pdf", "Not a PDF.")).retryable).toBe(false);
  });

  it("turns any other throw into a retryable internal error without leaking its text", () => {
    const failure = toFailure(new Error("connect ECONNREFUSED 10.0.0.1:5432 /srv/app/secret.ts"));
    expect(failure).toEqual({ code: "internal_error", message: UNEXPECTED_FAILURE, retryable: true });
    expect(toFailure("a string")).toEqual(failure);
  });

  it("keeps the cause for logging", () => {
    const cause = new Error("root");
    expect(new TaskError("x", "y", { cause }).cause).toBe(cause);
  });
});
