import { signInOverHttp, type ApiSession } from "./api-client";
import type { StackInfo } from "./stack";
import { FIRST_MEMBER, KR_ADMIN, STAFF } from "./users";

/** The people every stack starts with: Ada (first sign-in, so admin), Sam (staff), Kay (promoted to kr_admin by Ada). */
export async function seedPeople(stack: StackInfo): Promise<{ admin: ApiSession; staff: ApiSession }> {
  const admin = await signInOverHttp(stack, FIRST_MEMBER);
  const staff = await signInOverHttp(stack, STAFF);
  await signInOverHttp(stack, KR_ADMIN);
  const users = await admin.get<{ items: { id: string; email: string; version: number }[] }>("/v1/users?limit=100");
  const kayRow = users.items.find((u) => u.email === KR_ADMIN.email);
  if (!kayRow) throw new Error("Kay did not appear in the user list");
  await admin.patch(`/v1/users/${kayRow.id}`, { role: "kr_admin" }, `"${kayRow.version.toString()}"`);
  return { admin, staff };
}
