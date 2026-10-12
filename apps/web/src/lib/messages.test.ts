import { PROBLEM_TYPES } from "@kr/contracts";
import { describe, expect, it } from "vitest";
import { TRACKER_MESSAGES } from "@/features/tracker/messages";
import { ApiProblem, networkProblem } from "@/lib/api/problem";
import { MESSAGES, saveFailedMessage, saveFailedText } from "./messages";

const problem = (status: number, requestId = "req-1") =>
  new ApiProblem({ type: PROBLEM_TYPES.internal, title: "t", status, requestId });

describe("saveFailedText (request id only)", () => {
  it("adds the request id when there is one", () => {
    expect(saveFailedText("req-9")).toBe(
      "A change couldn't be saved. Reload the page and try again. (Request ID: req-9)",
    );
    expect(saveFailedText(undefined)).toBe(MESSAGES.saveFailed);
    expect(saveFailedText("")).toBe(MESSAGES.saveFailed);
  });
});

describe("saveFailedMessage (by failure type)", () => {
  it("says the server can't be reached for status 0 (the same text the tracker shows on load), with no request id", () => {
    const text = saveFailedMessage(networkProblem());
    expect(text).toBe(MESSAGES.offline);
    expect(text).toBe(TRACKER_MESSAGES.offline);
    expect(text).not.toMatch(/Request ID/);
  });

  it("asks to wait for 429 and keeps the request id", () => {
    expect(saveFailedMessage(problem(429))).toBe("Too many changes – wait a moment and try again. (Request ID: req-1)");
    expect(saveFailedMessage(problem(429, ""))).toBe("Too many changes – wait a moment and try again.");
  });

  it.each([400, 403, 404, 500, 503])("keeps the reload text with the request id for %i", (status) => {
    expect(saveFailedMessage(problem(status))).toBe(saveFailedText("req-1"));
  });

  it("keeps the reload text for an error that is not a problem", () => {
    expect(saveFailedMessage(new Error("boom"))).toBe(MESSAGES.saveFailed);
    expect(saveFailedMessage(undefined)).toBe(MESSAGES.saveFailed);
  });

  it("keeps connectivity and rate-limit wording but lets a feature word every other failure", () => {
    const own = (requestId: string | undefined) => `Own text${requestId ? ` (${requestId})` : ""}`;
    expect(saveFailedMessage(networkProblem(), own)).toBe(MESSAGES.offline);
    expect(saveFailedMessage(problem(429), own)).toMatch(/^Too many changes/);
    expect(saveFailedMessage(problem(500), own)).toBe("Own text (req-1)");
    expect(saveFailedMessage(new Error("boom"), own)).toBe("Own text");
  });
});
