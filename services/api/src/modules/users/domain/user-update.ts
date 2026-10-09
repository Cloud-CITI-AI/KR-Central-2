/**
 * Role and status changes by an admin (PRODUCT_SPEC §9.1, ADR-0003, ADR-0014). Pure: the caller loads and locks the rows.
 * Guards: no one changes their own role or status; guests stay `external`; the last active admin can be neither demoted
 * nor disabled. A change revokes the user's sessions, so the new privilege (or the lock-out) applies at once.
 */
import type { GlobalRole } from "@kr/contracts";
import { ConflictError, ForbiddenError } from "../../../platform/errors.js";

export interface UpdateTarget {
  readonly id: string;
  readonly role: GlobalRole;
  readonly status: "active" | "disabled";
  readonly isGuest: boolean;
}

export interface UserUpdateInput {
  readonly role?: GlobalRole | undefined;
  readonly status?: "active" | "disabled" | undefined;
}

export interface UserUpdatePlan {
  readonly isNoOp: boolean;
  readonly set: { role?: GlobalRole; status?: "active" | "disabled" };
  readonly changes: readonly { readonly field: "role" | "status"; readonly from: string; readonly to: string }[];
  readonly revokeReason: "role_changed" | "user_disabled";
}

export const LAST_ADMIN_MESSAGE = "There must be at least one active admin.";

export function planUserUpdate(
  actorId: string,
  target: UpdateTarget,
  input: UserUpdateInput,
  otherActiveAdmins: number,
): UserUpdatePlan {
  if (target.id === actorId) throw new ForbiddenError({ detail: "You cannot change your own role or status." });
  const role = input.role !== undefined && input.role !== target.role ? input.role : undefined;
  const status = input.status !== undefined && input.status !== target.status ? input.status : undefined;
  if (role !== undefined && role !== "external" && target.isGuest) {
    throw new ConflictError({ detail: "Guest accounts always have the external role." });
  }
  const losesAdmin =
    target.role === "admin" && target.status === "active" && (role !== undefined || status === "disabled");
  if (losesAdmin && otherActiveAdmins === 0) throw new ConflictError({ detail: LAST_ADMIN_MESSAGE });

  const changes = [
    ...(role === undefined ? [] : [{ field: "role" as const, from: target.role, to: role }]),
    ...(status === undefined ? [] : [{ field: "status" as const, from: target.status, to: status }]),
  ];
  return {
    isNoOp: changes.length === 0,
    set: { ...(role === undefined ? {} : { role }), ...(status === undefined ? {} : { status }) },
    changes,
    revokeReason: status === "disabled" ? "user_disabled" : "role_changed",
  };
}
