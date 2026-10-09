/** Reads of the signed-in user's own row, for the shell's bootstrap call (`getMe`). */
import type { Db, UserRow } from "@kr/db";

export type SessionUserProfile = Pick<UserRow, "created_at" | "last_sign_in_at" | "status">;

/** The account facts `getMe` returns beyond what the session already carries. The user exists: the session names it. */
export function findSessionUserProfile(db: Db, userId: string): Promise<SessionUserProfile> {
  return db
    .selectFrom("users")
    .select(["created_at", "last_sign_in_at", "status"])
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
}
