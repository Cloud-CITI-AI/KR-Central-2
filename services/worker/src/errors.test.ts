import { describe, expect, it } from "vitest";
import { TaskError, UNEXPECTED_FAILURE, describeError, toFailure } from "./errors.js";

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

describe("describeError", () => {
  it("names the error and its code but never repeats the message of a foreign error", () => {
    const pgError = Object.assign(new Error("duplicate key value (job_number)=(SECRET-1)"), { code: "23505" });
    const fields = describeError(pgError);
    expect(fields).toMatchObject({ errorName: "Error", errorCode: "23505" });
    expect(JSON.stringify(fields)).not.toContain("SECRET-1");
  });

  it("keeps the message of a TaskError, which is written for people", () => {
    expect(describeError(new TaskError("x", "Nothing to read."))).toMatchObject({ errorMessage: "Nothing to read." });
  });

  it("copes with a thrown non-error", () => {
    expect(describeError("text")).toEqual({ errorName: "string" });
  });
});
