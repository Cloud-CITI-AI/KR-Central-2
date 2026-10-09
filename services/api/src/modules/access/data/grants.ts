/** access_grants queries for the access manager (DATA_MODEL §3). */
import type { AccessGrantRow, Database, Db } from "@kr/db";
import { sql, type Transaction } from "kysely";

export interface GrantListRow {
  readonly row: AccessGrantRow;
  readonly jobNumber: string;
  readonly accountName: string | null;
  readonly invitedByName: string | null;
}

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

/** Grants of live jobs sorted by job number, email, id. Revoked grants are listed only when asked for. */
export async function listGrantRows(
  db: Db,
  o: {
    jobId?: string | undefined;
    status?: AccessGrantRow["status"] | undefined;
    afterId: string | null;
    limit: number;
  },
): Promise<GrantListRow[]> {
  let q = db
    .selectFrom("access_grants as g")
    .innerJoin("jobs as j", "j.id", "g.job_id")
    .leftJoin("users as bound", "bound.id", "g.user_id")
    .leftJoin("users as inviter", "inviter.id", "g.invited_by")
    .selectAll("g")
    .select(["j.job_number", "bound.display_name as account_name", "inviter.display_name as invited_by_name"])
    .where("j.deleted_at", "is", null)
    .where(o.status ? sql<boolean>`g.status = ${o.status}` : sql<boolean>`g.status <> 'revoked'`);
  if (o.jobId) q = q.where("g.job_id", "=", o.jobId);
  if (o.afterId !== null) {
    q = q.where(
      sql<boolean>`(j.job_number, g.email, g.id) > (select j2.job_number, g2.email, g2.id from access_grants g2 join jobs j2 on j2.id = g2.job_id where g2.id = ${o.afterId})`,
    );
  }
  const rows = await q
    .orderBy("j.job_number")
    .orderBy("g.email")
    .orderBy("g.id")
    .limit(o.limit + 1)
    .execute();
  return rows.map(({ job_number, account_name, invited_by_name, ...row }) => ({
    row,
    jobNumber: job_number,
    accountName: account_name,
    invitedByName: invited_by_name,
  }));
}

/** Lock a grant so two revocations of it serialise. */
export function lockGrant(trx: Transaction<Database>, grantId: string): Promise<AccessGrantRow | undefined> {
  return trx.selectFrom("access_grants").selectAll().where("id", "=", grantId).forUpdate().executeTakeFirst();
}

export async function revokeGrantRow(trx: Transaction<Database>, grantId: string, by: string, at: Date): Promise<void> {
  await trx
    .updateTable("access_grants")
    .set({ status: "revoked", revoked_at: at, revoked_by: by })
    .where("id", "=", grantId)
    .execute();
}

const OPEN_GRANT_KEY = "access_grants_job_email_open_key";

/** The partial unique index fired: another request added the same open grant first. */
export function isDuplicateGrant(error: unknown): boolean {
  const e = error as { code?: unknown; constraint?: unknown } | null;
  return typeof e === "object" && e !== null && e.code === "23505" && e.constraint === OPEN_GRANT_KEY;
}

export async function recordInvitation(
  trx: Transaction<Database>,
  grantId: string,
  status: "sent" | "failed",
  error: string | null,
): Promise<void> {
  await trx
    .updateTable("access_grants")
    .set({ invitation_status: status, invitation_error: error })
    .where("id", "=", grantId)
    .execute();
}
