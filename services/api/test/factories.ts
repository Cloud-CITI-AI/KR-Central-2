/**
 * Seeded faker factories over a real database (synthetic data only, TD-1). Each factory instance is deterministic for
 * its seed; the default seed is derived from the test file so parallel files never collide on unique columns.
 */
import { createHash } from "node:crypto";
import type { GlobalRole } from "@kr/contracts";
import type { Db, UserRow } from "@kr/db";
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

export function createFactories(db: Db, seed: number = seedFromTestFile()) {
  const faker = new Faker({ locale: [en_AU, en] });
  faker.seed(seed);
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
  };
}

export type Factories = ReturnType<typeof createFactories>;
