import { describe, expect, it } from "vitest";
import { cutoffs } from "./retention.js";

describe("cutoffs", () => {
  const now = new Date("2026-10-09T08:00:00.000Z");
  const c = cutoffs(now);

  it("purges files 30 days after deletion", () => {
    expect(c.filesDeletedBefore).toEqual(new Date("2026-09-09T08:00:00.000Z"));
  });

  it("keeps sessions 7 days after they ended and idempotency keys 24 hours", () => {
    expect(c.sessionsEndedBefore).toEqual(new Date("2026-10-02T08:00:00.000Z"));
    expect(c.idempotencyCreatedBefore).toEqual(new Date("2026-10-08T08:00:00.000Z"));
  });

  it("treats sign-in flows and rate limits as expired as soon as they pass, rate limits in epoch milliseconds", () => {
    expect(c.authFlowsExpiredBefore).toEqual(now);
    expect(c.rateLimitsExpiredBeforeMs).toBe(Date.parse("2026-10-09T08:00:00.000Z"));
  });

  it("calls a scan stuck after 15 minutes", () => {
    expect(c.pendingUploadedBefore).toEqual(new Date("2026-10-09T07:45:00.000Z"));
  });
});
