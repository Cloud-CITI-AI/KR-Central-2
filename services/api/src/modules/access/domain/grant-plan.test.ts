import { describe, expect, it } from "vitest";
import { duplicateGrantMessage, planGrant } from "./grant-plan.js";

const NOW = new Date("2026-03-02T01:00:00Z");

describe("planGrant", () => {
  it("is Pending with no account", () => {
    expect(planGrant([], NOW)).toEqual({ status: "pending", userId: null, activatedAt: null });
  });
  it("binds one existing external account at once", () => {
    expect(planGrant(["u1"], NOW)).toEqual({ status: "active", userId: "u1", activatedAt: NOW });
  });
  it("binds nothing when two accounts share the email", () => {
    expect(planGrant(["u1", "u2"], NOW)).toMatchObject({ status: "pending", userId: null });
  });
});

describe("duplicateGrantMessage", () => {
  it("uses the section 6 text", () => {
    expect(duplicateGrantMessage("x@y.z", "S-0001")).toBe("x@y.z is already on the list for S-0001.");
  });
});
