import { PROBLEM_TYPES, Problem } from "@kr/contracts";
import { describe, expect, it } from "vitest";
import { ApiProblem } from "@/lib/api";
import { uploadErrorText } from "./uploadErrors";

const context = { acceptDescription: "PDF or photo", maxBytes: 52_428_800 };
const problem = (status: number, requestId = "req-1") =>
  new ApiProblem(Problem.parse({ type: PROBLEM_TYPES.internal, title: "x", status, requestId }));

describe("uploadErrorText", () => {
  it("words 413 and 415 as section 5.5 does", () => {
    expect(uploadErrorText("Plan.pdf", problem(413), context)).toBe("Plan.pdf is larger than 50 MB");
    expect(uploadErrorText("Plan.exe", problem(415), context)).toBe(
      "Plan.exe isn't a supported type for this box (use PDF or photo)",
    );
  });

  it("explains rate limiting and a lost connection", () => {
    expect(uploadErrorText("a.pdf", problem(429), context)).toBe(
      "a.pdf wasn't uploaded – too many uploads at once, try again shortly",
    );
    expect(uploadErrorText("a.pdf", problem(0), context)).toBe(
      "a.pdf couldn't be uploaded – check your connection and try again",
    );
  });

  it("says file storage is temporarily unavailable on a 503 (S3 down), not a bare failure", () => {
    expect(uploadErrorText("a.pdf", problem(503), context)).toBe(
      "a.pdf wasn't uploaded – file storage is temporarily unavailable, try again shortly",
    );
  });

  it("names the request id for any other refusal and says nothing more for an unknown error", () => {
    expect(uploadErrorText("a.pdf", problem(500, "req-9"), context)).toBe(
      "a.pdf couldn't be uploaded (Request ID: req-9)",
    );
    expect(uploadErrorText("a.pdf", problem(403, ""), context)).toBe("a.pdf couldn't be uploaded");
    expect(uploadErrorText("a.pdf", new Error("boom"), context)).toBe("a.pdf couldn't be uploaded");
  });
});
