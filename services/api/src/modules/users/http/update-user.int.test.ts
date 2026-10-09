import type { ManagedUser } from "@kr/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import {
  apiRequest,
  createTestApp,
  signIn,
  testConfig,
  type SignedIn,
  type TestApp,
} from "../../../../test/helpers/index.js";

type Row = z.output<typeof ManagedUser>;

describe("updateUser (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") =>
    signIn(t, await f.makeUser({ role }), { amr: ["pwd", "mfa"] });
  const patch = (who: SignedIn | undefined, id: string, body: unknown, headers: Record<string, string> = {}) =>
    apiRequest(t, { method: "PATCH", url: `/v1/users/${id}`, body, headers, ...(who ? { as: who } : {}) });
  const audits = (id: string) =>
    t.db.selectFrom("audit_events").selectAll().where("entity_id", "=", id).orderBy("id").execute();
  const me = (who: SignedIn) => apiRequest(t, { url: "/v1/me", as: who });

  beforeAll(async () => {
    t = await createTestApp({ config: testConfig({ REQUIRE_MFA_FOR_ADMIN: "true" }) });
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
  });
  afterAll(async () => {
    await t.close();
  });

  it("is admin only and needs MFA evidence", async () => {
    for (const who of [krAdmin, staff, await as("external")]) {
      expect((await patch(who, staff.user.id, { role: "kr_admin" })).statusCode).toBe(403);
    }
    const res = await patch(await signIn(t, admin.user, { amr: ["pwd"] }), staff.user.id, { role: "kr_admin" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ detail: "Multi-factor sign-in required" });
  });

  it("changes a role or status, revokes every session of the user, bumps the version and audits each change", async () => {
    const target = await f.makeUser({ role: "staff" });
    const [one, two] = [await signIn(t, target), await signIn(t, target)];
    expect((await me(one)).statusCode).toBe(200);
    const res = await patch(admin, target.id, { role: "kr_admin" });
    expect(res.statusCode).toBe(200);
    expect(res.json<Row>()).toMatchObject({ id: target.id, role: "kr_admin", status: "active" });
    expect(res.headers.etag).toBe(`"${target.version + 1}"`);
    expect([(await me(one)).statusCode, (await me(two)).statusCode]).toEqual([401, 401]);
    const reasons = await t.db
      .selectFrom("sessions")
      .select("revoked_reason")
      .where("user_id", "=", target.id)
      .execute();
    expect(reasons).toEqual([{ revoked_reason: "role_changed" }, { revoked_reason: "role_changed" }]);

    const third = await signIn(t, target);
    const both = await patch(admin, target.id, { role: "staff", status: "disabled" });
    expect(both.json<Row>()).toMatchObject({ role: "staff", status: "disabled" });
    expect((await me(third)).statusCode).toBe(401);
    const disabled = await t.db
      .selectFrom("sessions")
      .select("id_hash")
      .where("user_id", "=", target.id)
      .where("revoked_reason", "=", "user_disabled")
      .execute();
    expect(disabled).toHaveLength(1);
    expect(
      (await t.db.selectFrom("users").select("version").where("id", "=", target.id).executeTakeFirstOrThrow()).version,
    ).toBe(target.version + 2);
    expect((await patch(admin, target.id, { status: "active" })).json<Row>().status).toBe("active");
    expect((await audits(target.id)).map((e) => [e.action, e.actor_user_id, e.job_id, e.changes])).toEqual([
      ["user.role_changed", admin.user.id, null, { role: { from: "staff", to: "kr_admin" } }],
      ["user.role_changed", admin.user.id, null, { role: { from: "kr_admin", to: "staff" } }],
      ["user.status_changed", admin.user.id, null, { status: { from: "active", to: "disabled" } }],
      ["user.status_changed", admin.user.id, null, { status: { from: "disabled", to: "active" } }],
    ]);
  });

  it("refuses your own account (403), guests becoming staff (409), unknown users (404) and bad bodies (400)", async () => {
    const guest = await f.makeUser({ role: "external" });
    expect((await patch(admin, admin.user.id, { role: "staff" })).statusCode).toBe(403);
    expect((await patch(admin, guest.id, { role: "staff" })).statusCode).toBe(409);
    expect((await patch(admin, "0f8fad5b-d9cb-469f-a165-70867728950e", { role: "staff" })).statusCode).toBe(404);
    for (const body of [{}, { role: "boss" }, { role: "staff", extra: 1 }]) {
      expect((await patch(admin, staff.user.id, body)).statusCode).toBe(400);
    }
    expect((await audits(admin.user.id)).filter((e) => e.action.startsWith("user.role"))).toEqual([]);
  });

  it("a change that changes nothing writes no audit event and keeps the sessions; If-Match is checked when sent", async () => {
    const target = await f.makeUser({ role: "staff" });
    const session = await signIn(t, target);
    expect((await patch(admin, target.id, { role: "staff", status: "active" })).statusCode).toBe(200);
    expect((await me(session)).statusCode).toBe(200);
    expect(await audits(target.id)).toEqual([]);
    expect(
      (await patch(admin, target.id, { role: "kr_admin" }, { "if-match": `"${target.version + 5}"` })).statusCode,
    ).toBe(412);
    expect((await patch(admin, target.id, { role: "kr_admin" }, { "if-match": "3" })).statusCode).toBe(400);
    expect(
      (await patch(admin, target.id, { role: "kr_admin" }, { "if-match": `"${target.version}"` })).statusCode,
    ).toBe(200);
  });
});
