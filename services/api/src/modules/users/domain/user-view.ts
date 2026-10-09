/** Database row → the contract's ManagedUser: a User plus its row version (admin screens only: it carries the email). */
import type { ManagedUser } from "@kr/contracts";
import type { UserRow } from "@kr/db";
import type { z } from "zod";

export function toUser(row: UserRow): z.output<typeof ManagedUser> {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    isGuest: row.is_guest,
    status: row.status,
    version: row.version,
    lastSignInAt: row.last_sign_in_at ? row.last_sign_in_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

/** `q` as a literal substring pattern for ILIKE: % _ and \ lose their meaning. */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
