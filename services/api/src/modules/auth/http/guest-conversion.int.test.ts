import { createDb, type Db } from "@kr/db";
import type { MockIdp, MockUser } from "@kr/mock-idp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from "vitest";
import { createTestApp, testConfig, type TestApp } from "../../../../test/helpers/index.js";
import { browserSignIn, lockBootstrap, mockUser, startIdpFor } from "../testing.js";

const staff = (n: number): MockUser =>
  mockUser(400 + n, {
    name: `Staff ${n}`,
    email: `staff${n}@krsurveys.com.au`,
    preferredUsername: `staff${n}@krsurveys.com.au`,
  });
/** `claimer` signs in first when the person under test must be plain staff: it takes the bootstrap. Never converted. */
const [firstStaff, laterStaff, memberStaying, claimer] = [staff(1), staff(2), staff(3), staff(4)] as const;

describe("a member converted to a B2B guest (real Postgres, mock IdP)", () => {
  let idp: MockIdp;
  let t: TestApp;
  let migrator: Db;
  let unlock: () => Promise<void>;

  beforeAll(async () => {
    unlock = await lockBootstrap(inject("databaseUrl"));
    idp = await startIdpFor(testConfig(), [firstStaff, laterStaff, memberStaying, claimer]);
    t = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: idp.authorityHost }) });
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

  const signIn = (u: MockUser) => browserSignIn(t.app, idp, { loginHint: u.oid });
  const userOf = (oid: string) =>
    t.db.selectFrom("users").selectAll().where("entra_object_id", "=", oid).executeTakeFirstOrThrow();
  const sessionsOf = (userId: string) =>
    t.db
      .selectFrom("sessions")
      .select(["revoked_at", "revoked_reason"])
      .where("user_id", "=", userId)
      .orderBy("created_at")
      .execute();

  it.each([
    ["admin", firstStaff],
    ["staff", laterStaff],
  ] as const)(
    "takes the %s role away on the next sign-in, audits it and revokes the older sessions",
    async (before, who) => {
      if (before === "staff") await signIn(claimer);
      await signIn(who);
      const member = await userOf(who.oid);
      expect(member).toMatchObject({ role: before, is_guest: false });
      expect(await sessionsOf(member.id)).toHaveLength(1);

      idp.addUser({ ...who, acct: 1 });
      const trip = await signIn(who);
      expect(trip.callback.statusCode).toBe(302);

      const guest = await userOf(who.oid);
      expect(guest).toMatchObject({ id: member.id, role: "external", is_guest: true, version: member.version + 1 });
      const sessions = await sessionsOf(member.id);
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toMatchObject({ revoked_reason: "role_changed" });
      expect(sessions[0]!.revoked_at).not.toBeNull();
      expect(sessions[1]).toEqual({ revoked_at: null, revoked_reason: null });

      const events = await t.db
        .selectFrom("audit_events")
        .select(["action", "actor_user_id", "changes"])
        .where("entity_id", "=", member.id)
        .where("action", "=", "user.role_changed")
        .execute();
      expect(events).toEqual([
        {
          action: "user.role_changed",
          actor_user_id: member.id,
          changes: { role: { from: before, to: "external" }, is_guest: { from: false, to: true } },
        },
      ]);

      // Signing in again as the guest changes nothing more.
      await signIn(who);
      expect(await userOf(who.oid)).toMatchObject({ role: "external", version: guest.version });
      expect(
        await t.db
          .selectFrom("audit_events")
          .select("id")
          .where("entity_id", "=", member.id)
          .where("action", "=", "user.role_changed")
          .execute(),
      ).toHaveLength(1);
    },
  );

  it("leaves a member who stays a member untouched: role, version and sessions", async () => {
    await signIn(memberStaying);
    const before = await userOf(memberStaying.oid);
    await signIn(memberStaying);
    const after = await userOf(memberStaying.oid);
    expect(after).toMatchObject({ role: before.role, version: before.version });
    expect(
      (await sessionsOf(before.id)).every((s) => s.revoked_at === null || s.revoked_reason !== "role_changed"),
    ).toBe(true);
    expect(
      await t.db
        .selectFrom("audit_events")
        .select("id")
        .where("entity_id", "=", before.id)
        .where("action", "=", "user.role_changed")
        .execute(),
    ).toHaveLength(0);
  });
});
