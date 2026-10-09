/**
 * Seeded faker factories over a real database (synthetic data only, TD-1). Each factory instance is deterministic for
 * its seed; the default seed is derived from the test file so parallel files never collide on unique columns.
 */
import { createHash } from "node:crypto";
import type { GlobalRole } from "@kr/contracts";
import type { AccessGrantRow, Db, JobRow, UserRow } from "@kr/db";
import { CHECKPOINTS, SUBDIVISION_TYPES } from "@kr/workflow";
import { Faker, en, en_AU } from "@faker-js/faker";
import { expect } from "vitest";

export const TEST_TENANT_ID = "11111111-1111-4111-8111-111111111111";

function seedFromTestFile(): number {
  const file = expect.getState().testPath ?? "unknown";
  return createHash("sha256").update(file).digest().readUInt32BE(0);
}

export interface UserOverrides {
  readonly role?: GlobalRole;
  readonly status?: "active" | "disabled";
  readonly isGuest?: boolean;
  readonly email?: string | null;
  readonly displayName?: string;
}

export interface JobOverrides {
  readonly jobNumber?: string;
  readonly createdBy?: string | null;
  /** Archived (soft-deleted) when set. */
  readonly deletedAt?: Date | null;
}

export interface GrantOverrides {
  readonly jobId: string;
  readonly role?: "client" | "architect";
  readonly status?: "pending" | "active" | "revoked";
  /** Required for active grants (bound user). */
  readonly userId?: string | null;
  readonly email?: string;
}

const WA_TOWNS = ["Busselton", "Dunsborough", "Margaret River", "Bunbury", "Mandurah", "Rockingham"];

export function createFactories(db: Db, seed: number = seedFromTestFile()) {
  const faker = new Faker({ locale: [en_AU, en] });
  faker.seed(seed);
  const prefix = `T${seed.toString(36).slice(0, 6).toUpperCase()}`;
  let jobCounter = 0;
  return {
    faker,
    async makeUser(o: UserOverrides = {}): Promise<UserRow> {
      const role = o.role ?? "staff";
      return db
        .insertInto("users")
        .values({
          entra_tenant_id: TEST_TENANT_ID,
          entra_object_id: faker.string.uuid(),
          email: o.email === undefined ? faker.internet.email({ provider: "example.test" }).toLowerCase() : o.email,
          display_name: o.displayName ?? faker.person.fullName(),
          role,
          is_guest: o.isGuest ?? role === "external",
          status: o.status ?? "active",
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },
    /** A job with its 46 checkpoint_states (default responsibilities), like the real createJob. Synthetic data only. */
    async makeJob(o: JobOverrides = {}): Promise<JobRow> {
      jobCounter += 1;
      return db.transaction().execute(async (trx) => {
        const job = await trx
          .insertInto("jobs")
          .values({
            job_number: o.jobNumber ?? `${prefix}-${jobCounter}`,
            address: `${faker.location.streetAddress()}, ${faker.helpers.arrayElement(WA_TOWNS)} WA ${faker.number.int({ min: 6000, max: 6999 })}`,
            client_name: `${faker.company.name()} Pty Ltd`,
            subdivision_type: faker.helpers.arrayElement(SUBDIVISION_TYPES),
            created_by: o.createdBy ?? null,
            deleted_at: o.deletedAt ?? null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("checkpoint_states")
          .values(
            CHECKPOINTS.map((c) => ({
              job_id: job.id,
              checkpoint_key: c.key,
              responsibility: c.defaultResponsibility,
            })),
          )
          .execute();
        return job;
      });
    },
    async makeGrant(o: GrantOverrides): Promise<AccessGrantRow> {
      const status = o.status ?? "active";
      const bound = status === "active" || o.userId;
      return db
        .insertInto("access_grants")
        .values({
          job_id: o.jobId,
          email: o.email ?? faker.internet.email({ provider: "example.test" }).toLowerCase(),
          role: o.role ?? "client",
          status,
          user_id: o.userId ?? null,
          ...(bound ? { activated_at: new Date() } : {}),
          ...(status === "revoked" ? { revoked_at: new Date() } : {}),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },
  };
}

export type Factories = ReturnType<typeof createFactories>;
