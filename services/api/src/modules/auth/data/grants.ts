/** Activation of pending access grants at sign-in (PRODUCT_SPEC §3.4, ADR-0014). */
import type { Database } from "@kr/db";
import type { Transaction } from "kysely";

const openJobs = (trx: Transaction<Database>) => trx.selectFrom("jobs").select("id").where("deleted_at", "is", null);

/** Pending grants for this address on jobs that are not archived (`email` is citext: the match ignores case). */
export async function countActivatableGrants(trx: Transaction<Database>, email: string): Promise<number> {
  const row = await trx
    .selectFrom("access_grants")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("email", "=", email)
    .where("status", "=", "pending")
    .where("job_id", "in", openJobs(trx))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Active grants bound to this user on jobs that are not archived. */
export async function countActiveGrantsOf(trx: Transaction<Database>, userId: string): Promise<number> {
  const row = await trx
    .selectFrom("access_grants")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("user_id", "=", userId)
    .where("status", "=", "active")
    .where("job_id", "in", openJobs(trx))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Activate them and bind them to the user id for good: a later email change does not move access. */
export function activateGrants(
  trx: Transaction<Database>,
  email: string,
  userId: string,
  now: Date,
): Promise<{ id: string; job_id: string }[]> {
  return trx
    .updateTable("access_grants")
    .set({ status: "active", user_id: userId, activated_at: now })
    .where("email", "=", email)
    .where("status", "=", "pending")
    .where("job_id", "in", openJobs(trx))
    .returning(["id", "job_id"])
    .execute();
}
