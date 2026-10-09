import { createDb, type Db } from "@kr/db";
import { startTestDatabase, type TestDatabase } from "@kr/db/testing";
import type { LightMyRequestResponse } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

/**
 * The last-admin guarantee counts every active admin, so this file runs against its OWN database: other test files
 * create admins in the shared one at any time.
 */
describe("the last active admin (own Postgres database)", () => {
  let own: TestDatabase;
  let db: Db;
  let t: TestApp;
  let f: Factories;
  const demote = (who: SignedIn, targetId: string, body: unknown) =>
    apiRequest(t, { method: "PATCH", url: `/v1/users/${targetId}`, as: who, body });
  const waiters = async () =>
    Number(
      (await sql<{ n: string }>`select count(*) as n from pg_stat_activity where wait_event_type = 'Lock'`.execute(db))
        .rows[0]?.n,
    );
  const activeAdmins = async () =>
    (await db.selectFrom("users").select("id").where("role", "=", "admin").where("status", "=", "active").execute())
      .length;

  beforeAll(async () => {
    own = await startTestDatabase();
    db = createDb({ connectionString: own.appUrl, applicationName: "kr-api-test-last-admin" });
    t = await createTestApp({ db });
    f = createFactories(db);
  });
  afterAll(async () => {
    await t.close();
    await db.destroy();
    await own.stop();
  });

  it.each([
    ["demoting each other", { role: "staff" }],
    ["disabling each other", { status: "disabled" }],
    ["demoting and disabling each other", { role: "kr_admin", status: "disabled" }],
  ])("two admins %s at the same time: exactly one succeeds and one admin remains", async (_name, body) => {
    for (let round = 0; round < 6; round += 1) {
      const [a, b] = [await f.makeUser({ role: "admin" }), await f.makeUser({ role: "admin" })];
      const [sa, sb] = [await signIn(t, a), await signIn(t, b)];
      // Only these two are active admins, whatever earlier rounds left behind.
      await db
        .updateTable("users")
        .set({ role: "staff" })
        .where("id", "not in", [a.id, b.id])
        .where("role", "=", "admin")
        .execute();
      const results = await Promise.all([demote(sa, b.id, body), demote(sb, a.id, body)]);
      // The loser is refused by the guard (409) or, when the winner's commit came first, has lost its session (401).
      const [winner, loser] = results.map((r) => r.statusCode).sort();
      expect(winner).toBe(200);
      expect([401, 409]).toContain(loser);
      expect(await activeAdmins()).toBe(1);
    }
  });

  it("a request that authenticated before its admin was demoted cannot demote the last admin left", async () => {
    const [a, b] = [await f.makeUser({ role: "admin" }), await f.makeUser({ role: "admin" })];
    const staleActor = await signIn(t, b);
    await db
      .updateTable("users")
      .set({ role: "staff" })
      .where("id", "not in", [a.id, b.id])
      .where("role", "=", "admin")
      .execute();
    let pending: Promise<LightMyRequestResponse> | undefined;
    await db.transaction().execute(async (trx) => {
      await trx.selectFrom("users").select("id").where("id", "in", [a.id, b.id]).forUpdate().execute();
      pending = demote(staleActor, a.id, { role: "staff" });
      // Wait until the request is queued on our row locks, then demote its actor behind its back (no session revoke).
      for (let i = 0; i < 100 && (await waiters()) === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
      await trx.updateTable("users").set({ role: "staff" }).where("id", "=", b.id).execute();
    });
    const res = await pending;
    expect(res?.statusCode).toBe(409);
    expect(res?.json()).toMatchObject({ detail: "There must be at least one active admin." });
    expect(await activeAdmins()).toBe(1);
  });
});
