import { createDb, type Db } from "@kr/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createFactories, type Factories } from "../../test/factories.js";
import { createTestApp, signIn, type TestApp } from "../../test/helpers/index.js";
import { lockBootstrap } from "../modules/auth/testing.js";
import { main } from "./promote-admin.js";

describe("promote-admin CLI (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let migrator: Db;
  let unlock: () => Promise<void>;
  let out: string[];
  let err: string[];

  beforeAll(async () => {
    unlock = await lockBootstrap(inject("databaseUrl"));
    t = await createTestApp();
    f = createFactories(t.db);
    migrator = createDb({ connectionString: inject("migratorDatabaseUrl"), applicationName: "kr-api-test-migrator" });
  });
  beforeEach(async () => {
    out = [];
    err = [];
    await migrator.deleteFrom("system_bootstrap").execute();
  });
  afterAll(async () => {
    await migrator.destroy();
    await t.close();
    await unlock();
  });

  const run = (...argv: string[]) =>
    main(argv, { db: t.db, clock: t.clock, out: (l) => out.push(l), err: (l) => err.push(l) });
  const userRow = (id: string) => t.db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  const auditFor = (id: string) =>
    t.db.selectFrom("audit_events").selectAll().where("entity_id", "=", id).orderBy("id").execute();

  it("promotes an active member to admin as the system actor, revokes their sessions and claims the bootstrap", async () => {
    const member = await f.makeUser({ role: "staff", email: "Ops.Person@Example.test" });
    await signIn(t, member);
    expect(await run("  OPS.person@example.TEST ")).toBe(0);

    expect(await userRow(member.id)).toMatchObject({ role: "admin", version: member.version + 1 });
    const [event] = await auditFor(member.id);
    expect(event).toMatchObject({
      action: "user.role_changed",
      actor_user_id: null,
      actor_type: "system",
      entity_type: "user",
      changes: { role: { from: "staff", to: "admin" } },
    });
    const revoked = await t.db
      .selectFrom("sessions")
      .select("revoked_reason")
      .where("user_id", "=", member.id)
      .execute();
    expect(revoked).toEqual([{ revoked_reason: "role_changed" }]);
    expect(await t.db.selectFrom("system_bootstrap").select("first_admin_user_id").execute()).toEqual([
      { first_admin_user_id: member.id },
    ]);
    expect(out.join("\n")).toContain(member.id);
    expect(`${out.join()}${err.join()}`).not.toContain("example.test");
  });

  it("promotes a member who is not on a staff domain (role external) too", async () => {
    const member = await f.makeUser({ role: "external", isGuest: false });
    expect(await run(member.email!)).toBe(0);
    expect((await userRow(member.id)).role).toBe("admin");
  });

  it("leaves an existing admin alone: exit 0, no audit event", async () => {
    const admin = await f.makeUser({ role: "admin" });
    expect(await run(admin.email!)).toBe(0);
    expect(await auditFor(admin.id)).toEqual([]);
    expect(out.join()).toContain("already an admin");
  });

  it("refuses a guest, whatever the address, without changing or auditing anything", async () => {
    const guest = await f.makeUser({ role: "external", isGuest: true });
    expect(await run(guest.email!)).toBe(1);
    expect(err.join()).toContain("guest");
    expect((await userRow(guest.id)).role).toBe("external");
    expect(await auditFor(guest.id)).toEqual([]);
    expect(await t.db.selectFrom("system_bootstrap").select("singleton").execute()).toEqual([]);
  });

  it.each([
    ["a disabled member", async () => (await f.makeUser({ role: "staff", status: "disabled" })).email!, "disabled"],
    ["an address nobody signed in with", () => Promise.resolve("nobody@example.test"), "No user"],
  ])("refuses %s", async (_name, email, message) => {
    expect(await run(await email())).toBe(1);
    expect(err.join()).toContain(message);
  });

  it("refuses an address shared by two active members", async () => {
    const shared = "shared@example.test";
    const [a, b] = [await f.makeUser({ email: shared }), await f.makeUser({ email: shared })];
    expect(await run(shared)).toBe(1);
    expect(err.join()).toContain("more than one");
    expect([(await userRow(a.id)).role, (await userRow(b.id)).role]).toEqual(["staff", "staff"]);
  });

  it.each([[[]], [["a@example.test", "b@example.test"]], [["not-an-email"]]])(
    "prints usage and exits 2 for %j",
    async (argv) => {
      expect(await run(...argv)).toBe(2);
      expect(err.join()).toContain("Usage: promote-admin <email>");
    },
  );
});
