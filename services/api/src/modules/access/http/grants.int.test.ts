import type { AccessGrant } from "@kr/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

type Grant = z.output<typeof AccessGrant>;
describe("access grants (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const create = (who: SignedIn | undefined, body: unknown, headers: Record<string, string> = {}) =>
    apiRequest(t, { method: "POST", url: "/v1/access-grants", body, headers, ...(who ? { as: who } : {}) });
  const markRevoked = (id: string) =>
    t.db.updateTable("access_grants").set({ status: "revoked", revoked_at: new Date() }).where("id", "=", id).execute();
  const audits = (action: string, entityId: string) =>
    t.db
      .selectFrom("audit_events")
      .selectAll()
      .where("action", "=", action)
      .where("entity_id", "=", entityId)
      .execute();

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, krAdmin, staff, client] = [
      await as("admin"),
      await as("kr_admin"),
      await as("staff"),
      await as("external"),
    ];
  });
  afterAll(async () => {
    await t.close();
  });

  it("staff, kr_admin and admin add a pending grant with a lower-cased email; the audit event is written", async () => {
    for (const who of [staff, krAdmin, admin]) {
      const job = await f.makeJob();
      const res = await create(who, {
        email: "  New.Person@Example.TEST ",
        displayName: "New Person",
        role: "client",
        jobId: job.id,
      });
      expect(res.statusCode).toBe(201);
      const grant = res.json<Grant>();
      expect(grant).toEqual({
        id: expect.any(String),
        jobId: job.id,
        jobNumber: job.job_number,
        email: "new.person@example.test",
        displayName: "New Person",
        role: "client",
        status: "pending",
        invitationStatus: "not_sent",
        invitedAt: t.deps.clock.now().toISOString(),
        invitedBy: { id: who.user.id, displayName: who.user.display_name },
        activatedAt: null,
      });
      const [event] = await audits("access_grant.created", grant.id);
      expect(event).toMatchObject({
        actor_user_id: who.user.id,
        job_id: job.id,
        request_id: res.headers["x-request-id"],
        changes: { email: { to: "new.person@example.test" }, role: { to: "client" }, status: { to: "pending" } },
      });
    }
  });

  it("only staff roles may use the access manager (403 for externals, 401 without a session)", async () => {
    const job = await f.makeJob();
    const body = { email: "a@example.test", role: "architect", jobId: job.id };
    expect((await create(client, body)).statusCode).toBe(403);
    expect((await create(undefined, body)).statusCode).toBe(401);
    expect((await create(staff, { ...body, email: "not-an-email" })).statusCode).toBe(400);
    expect((await create(staff, { ...body, role: "staff" })).statusCode).toBe(400);
    expect((await create(staff, { ...body, jobId: "0f8fad5b-d9cb-469f-a165-70867728950e" })).statusCode).toBe(404);
    const archived = await f.makeJob({ deletedAt: new Date() });
    expect((await create(staff, { ...body, jobId: archived.id })).statusCode).toBe(404);
  });

  it("a duplicate pending or active grant is 409 with the section 6 text; a revoked one can be granted again", async () => {
    const job = await f.makeJob();
    const body = { email: "dup@example.test", role: "client", jobId: job.id };
    const first = (await create(staff, body)).json<Grant>();
    for (const again of [body, { ...body, email: "DUP@example.test", role: "architect" }]) {
      const res = await create(staff, again);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ detail: `dup@example.test is already on the list for ${job.job_number}.` });
    }
    await t.db
      .updateTable("access_grants")
      .set({ status: "active", user_id: client.user.id, activated_at: new Date() })
      .where("id", "=", first.id)
      .execute();
    expect((await create(staff, body)).statusCode).toBe(409);
    await markRevoked(first.id);
    expect((await create(staff, body)).statusCode).toBe(201);
    // Another job is a different list.
    expect((await create(staff, { ...body, jobId: (await f.makeJob()).id })).statusCode).toBe(201);
  });

  it("concurrent identical requests give exactly one grant", async () => {
    const job = await f.makeJob();
    const body = { email: "race@example.test", role: "client", jobId: job.id };
    const results = await Promise.all([create(staff, body), create(admin, body), create(krAdmin, body)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
  });

  it("an existing external user with that email is Active and bound at once, shown with the account name", async () => {
    const guest = await f.makeUser({ role: "external", email: "guest@example.test", displayName: "Gwen Guest" });
    const job = await f.makeJob();
    const res = await create(staff, {
      email: "Guest@Example.test",
      displayName: "Typed Name",
      role: "client",
      jobId: job.id,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<Grant>()).toMatchObject({
      status: "active",
      displayName: "Gwen Guest",
      activatedAt: t.deps.clock.now().toISOString(),
    });
    const row = await t.db
      .selectFrom("access_grants")
      .selectAll()
      .where("id", "=", res.json<Grant>().id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ user_id: guest.id, status: "active" });
    const guestSession = await signIn(t, guest);
    expect((await apiRequest(t, { url: `/v1/jobs/${job.id}`, as: guestSession })).statusCode).toBe(200);
  });
});
