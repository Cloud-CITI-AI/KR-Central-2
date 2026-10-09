import { createDb, type Db } from "@kr/db";
import type { MockIdp } from "@kr/mock-idp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createTestApp, testConfig, type TestApp } from "../../../../test/helpers/index.js";
import { browserSignIn, lockBootstrap, mockUser, startIdpFor } from "../testing.js";

const staff = (n: number) =>
  mockUser(100 + n, {
    name: `Staff ${n}`,
    email: `staff${n}@krsurveys.com.au`,
    preferredUsername: `staff${n}@krsurveys.com.au`,
  });
const staffUsers = Array.from({ length: 4 }, (_, i) => staff(i + 1));
/** Never signed in before the concurrent test: an earlier admin would be counted as an extra one. */
const racers = Array.from({ length: 8 }, (_, i) => staff(i + 50));
const guestWithStaffAddress = mockUser(120, { acct: 1, email: "guest@krsurveys.com.au" });
const outsider = mockUser(121);

describe("first admin (real Postgres, mock IdP)", () => {
  let idp: MockIdp;
  let t: TestApp;
  let migrator: Db;
  let unlock: () => Promise<void>;

  beforeAll(async () => {
    unlock = await lockBootstrap(inject("databaseUrl"));
    idp = await startIdpFor(testConfig(), [...staffUsers, ...racers, guestWithStaffAddress, outsider]);
    t = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: idp.authorityHost }) });
    // The app role may only INSERT/SELECT system_bootstrap (audit-grade); the owner resets it between tests.
    migrator = createDb({ connectionString: inject("migratorDatabaseUrl"), applicationName: "kr-api-test-migrator" });
  });
  beforeEach(async () => {
    await migrator.deleteFrom("system_bootstrap").execute();
  });
  afterAll(async () => {
    await migrator.destroy();
    await t.close();
    await idp.stop();
    await unlock();
  });

  const signInAs = (u: { email: string | null }) => browserSignIn(t.app, idp, { loginHint: u.email! });
  const roleOf = async (oid: string) =>
    (await t.db.selectFrom("users").select("role").where("entra_object_id", "=", oid).executeTakeFirstOrThrow()).role;
  const bootstrapRows = () => t.db.selectFrom("system_bootstrap").selectAll().execute();

  it("makes the first staff member admin, records the bootstrap row and audits it; the next one is plain staff", async () => {
    await signInAs(staffUsers[0]!);
    const [first, second] = [staffUsers[0]!, staffUsers[1]!];
    const admin = await t.db
      .selectFrom("users")
      .selectAll()
      .where("entra_object_id", "=", first.oid)
      .executeTakeFirstOrThrow();
    expect(admin.role).toBe("admin");
    expect(await bootstrapRows()).toMatchObject([{ singleton: true, first_admin_user_id: admin.id }]);

    await signInAs(second);
    expect(await roleOf(second.oid)).toBe("staff");
    expect(await bootstrapRows()).toHaveLength(1);

    const events = await t.db
      .selectFrom("audit_events")
      .select(["action", "actor_user_id", "actor_type", "entity_id", "request_id", "changes"])
      .where("entity_id", "=", admin.id)
      .orderBy("id")
      .execute();
    expect(events.map((e) => e.action)).toEqual(["user.created", "user.first_admin_assigned", "auth.signin"]);
    expect(events[1]).toMatchObject({
      actor_user_id: admin.id,
      actor_type: "user",
      changes: { role: { from: "staff", to: "admin" } },
    });
    expect(events.every((e) => typeof e.request_id === "string")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(first.email!);
  });

  it("never makes a guest or a non-KR member the first admin, whatever the address; a later staff member still is", async () => {
    await signInAs(guestWithStaffAddress);
    await signInAs(outsider);
    expect(await roleOf(guestWithStaffAddress.oid)).toBe("external");
    expect(await roleOf(outsider.oid)).toBe("external");
    expect(await bootstrapRows()).toEqual([]);
    await signInAs(staffUsers[2]!);
    expect(await roleOf(staffUsers[2]!.oid)).toBe("admin");
  });

  it("keeps an admin an admin on later sign-ins without a second assignment", async () => {
    const who = staffUsers[3]!;
    await signInAs(who);
    await signInAs(who);
    const row = await t.db
      .selectFrom("users")
      .select(["id", "role"])
      .where("entra_object_id", "=", who.oid)
      .executeTakeFirstOrThrow();
    expect(row.role).toBe("admin");
    const actions = await t.db
      .selectFrom("audit_events")
      .select("action")
      .where("entity_id", "=", row.id)
      .orderBy("id")
      .execute();
    expect(actions.map((a) => a.action)).toEqual([
      "user.created",
      "user.first_admin_assigned",
      "auth.signin",
      "auth.signin",
    ]);
  });

  it("produces exactly one admin when many staff sign in at the same instant", async () => {
    const concurrent = racers;
    const trips = await Promise.all(concurrent.map((u) => signInAs(u)));
    expect(trips.map((trip) => [trip.callback.statusCode, trip.callback.headers.location])).toEqual(
      trips.map(() => [302, "/"]),
    );
    const roles = await Promise.all(concurrent.map((u) => roleOf(u.oid)));
    expect(roles.filter((r) => r === "admin")).toHaveLength(1);
    expect(roles.filter((r) => r === "staff")).toHaveLength(concurrent.length - 1);
    expect(await bootstrapRows()).toHaveLength(1);
  });
});
