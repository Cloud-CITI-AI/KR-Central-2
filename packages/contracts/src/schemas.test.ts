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
