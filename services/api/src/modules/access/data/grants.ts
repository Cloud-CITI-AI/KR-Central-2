/** access_grants queries for the access manager (DATA_MODEL §3). */
import type { AccessGrantRow, Database } from "@kr/db";
import type { Transaction } from "kysely";

/** Ids of the external accounts that carry this email (`email` is citext: the match ignores case). */
export async function findExternalAccountIds(trx: Transaction<Database>, email: string): Promise<string[]> {
  const rows = await trx
    .selectFrom("users")
    .select("id")
    .where("email", "=", email)
    .where("role", "=", "external")
    .execute();
  return rows.map((r) => r.id);
}

export function findOpenGrant(trx: Transaction<Database>, jobId: string, email: string) {
  return trx
    .selectFrom("access_grants")
    .select("id")
    .where("job_id", "=", jobId)
    .where("email", "=", email)
    .where("status", "<>", "revoked")
    .executeTakeFirst();
}

export function insertGrant(
  trx: Transaction<Database>,
  grant: {
    jobId: string;
    email: string;
    displayName: string | null;
    role: AccessGrantRow["role"];
    status: "pending" | "active";
    userId: string | null;
    invitedBy: string;
    at: Date;
    activatedAt: Date | null;
  },
): Promise<AccessGrantRow> {
  return trx
    .insertInto("access_grants")
    .values({
      job_id: grant.jobId,
      email: grant.email,
      display_name: grant.displayName,
      role: grant.role,
      status: grant.status,
      user_id: grant.userId,
      invited_by: grant.invitedBy,
      invited_at: grant.at,
      activated_at: grant.activatedAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function userName(trx: Transaction<Database>, userId: string | null): Promise<string | null> {
  if (userId === null) return null;
  const row = await trx.selectFrom("users").select("display_name").where("id", "=", userId).executeTakeFirst();
  return row?.display_name ?? null;
}

const OPEN_GRANT_KEY = "access_grants_job_email_open_key";

/** The partial unique index fired: another request added the same open grant first. */
export function isDuplicateGrant(error: unknown): boolean {
  const e = error as { code?: unknown; constraint?: unknown } | null;
  return typeof e === "object" && e !== null && e.code === "23505" && e.constraint === OPEN_GRANT_KEY;
}
