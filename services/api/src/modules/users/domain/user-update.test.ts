import { describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors.js";
import { LAST_ADMIN_MESSAGE, planUserUpdate, type UpdateTarget } from "./user-update.js";

const target = (o: Partial<UpdateTarget> = {}): UpdateTarget => ({
  id: "t",
  role: "staff",
  status: "active",
  isGuest: false,
  ...o,
});
const refusal = (fn: () => unknown): { status: number; message: string } => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, message: e.message };
  }
  throw new Error("expected an AppError");
};

describe("planUserUpdate", () => {
  it("plans one change per differing field and revokes sessions with the matching reason", () => {
    expect(planUserUpdate("a", target(), { role: "kr_admin" }, 1)).toMatchObject({
      isNoOp: false,
      set: { role: "kr_admin" },
      changes: [{ field: "role", from: "staff", to: "kr_admin" }],
      revokeReason: "role_changed",
    });
    expect(planUserUpdate("a", target(), { role: "admin", status: "disabled" }, 1)).toMatchObject({
      set: { role: "admin", status: "disabled" },
      revokeReason: "user_disabled",
    });
  });

  it("is a no-op when nothing differs", () => {
    expect(planUserUpdate("a", target(), { role: "staff", status: "active" }, 1)).toMatchObject({
      isNoOp: true,
      set: {},
    });
  });

  it("refuses a change to your own account", () => {
    expect(refusal(() => planUserUpdate("t", target(), { role: "admin" }, 1))).toMatchObject({ status: 403 });
  });

  it("keeps guests external", () => {
    expect(
      refusal(() => planUserUpdate("a", target({ role: "external", isGuest: true }), { role: "staff" }, 1)),
    ).toMatchObject({ status: 409 });
    expect(planUserUpdate("a", target({ role: "external", isGuest: true }), { status: "disabled" }, 1).isNoOp).toBe(
      false,
    );
  });

  it("protects the last active admin from demotion and from being disabled", () => {
    const admin = target({ role: "admin" });
    for (const input of [{ role: "staff" as const }, { status: "disabled" as const }]) {
      expect(refusal(() => planUserUpdate("a", admin, input, 0))).toEqual({ status: 409, message: LAST_ADMIN_MESSAGE });
      expect(planUserUpdate("a", admin, input, 1).isNoOp).toBe(false);
    }
    expect(planUserUpdate("a", admin, { role: "admin", status: "active" }, 0).isNoOp).toBe(true);
  });
});
