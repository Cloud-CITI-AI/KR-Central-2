import { describe, expect, it } from "vitest";
import {
  CreateAccessGrantRequest,
  CreateJobRequest,
  RecordDecisionRequest,
  UpdateCheckpointRequest,
  UploadFields,
} from "./schemas.js";

describe("request schemas", () => {
  it("requires a comment to decline", () => {
    expect(RecordDecisionRequest.safeParse({ value: "declined", comment: "  " }).success).toBe(false);
    expect(RecordDecisionRequest.safeParse({ value: "declined", comment: "Too expensive" }).success).toBe(true);
    expect(RecordDecisionRequest.parse({ value: "accepted" }).comment).toBe("");
  });

  it.each([
    ["zero-width space", "\u200b"],
    ["zero-width non-joiner and joiner", "\u200c\u200d"],
    ["word joiner", "\u2060"],
    ["byte order mark", "\ufeff"],
    ["soft hyphen", "\u00ad"],
    ["no-break space and ideographic space", "\u00a0\u3000"],
    ["mixed spaces and invisibles", " \t\n\u200b \u2060\ufeff"],
  ])("refuses a decline whose comment is only %s (R14: non-blank in the API too)", (_name, comment) => {
    const result = RecordDecisionRequest.safeParse({ value: "declined", comment });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["comment"],
      message: "Add a comment explaining why it is declined.",
    });
  });

  it("accepts a visible comment even with invisible characters around it, and an accept without a comment", () => {
    expect(RecordDecisionRequest.safeParse({ value: "declined", comment: "\u200bToo dear\u200b" }).success).toBe(true);
    expect(RecordDecisionRequest.safeParse({ value: "declined", comment: "\u00e9" }).success).toBe(true);
    expect(RecordDecisionRequest.safeParse({ value: "accepted", comment: "\u200b" }).success).toBe(true);
  });

  it("rejects unknown fields (strict objects)", () => {
    expect(UpdateCheckpointRequest.safeParse({ status: "completed", extra: 1 }).success).toBe(false);
    expect(UpdateCheckpointRequest.safeParse({}).success).toBe(false);
  });

  it("validates job numbers", () => {
    expect(
      CreateJobRequest.safeParse({ jobNumber: "S-0001", address: "1 Test Rd", subdivisionType: "Freehold" }).success,
    ).toBe(true);
    expect(
      CreateJobRequest.safeParse({ jobNumber: "<script>", address: "x", subdivisionType: "Freehold" }).success,
    ).toBe(false);
  });

  it("normalises grant emails", () => {
    const g = CreateAccessGrantRequest.parse({
      email: " Person@Example.COM ",
      role: "client",
      jobId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    });
    expect(g.email).toBe("person@example.com");
  });

  it("accepts either a checkpoint slot or a condition for uploads", () => {
    expect(UploadFields.safeParse({ checkpointKey: "i2_0", slot: "survey" }).success).toBe(true);
    expect(UploadFields.safeParse({ conditionId: "0f8fad5b-d9cb-469f-a165-70867728950e" }).success).toBe(true);
    expect(UploadFields.safeParse({ checkpointKey: "i2_0" }).success).toBe(false);
    expect(UploadFields.safeParse({ checkpointKey: "nope", slot: "x" }).success).toBe(false);
  });
});
