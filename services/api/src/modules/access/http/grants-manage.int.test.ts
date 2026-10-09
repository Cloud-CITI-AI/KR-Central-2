import type { AccessGrant } from "@kr/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

type Grant = z.output<typeof AccessGrant>;
interface Page {
  items: Grant[];
  nextCursor: string | null;
}
const UNKNOWN = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("listing and revoking access grants (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, staff: SignedIn, client: SignedIn;
  const as = async (role: "admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const create = (jobId: string, email: string) =>
    apiRequest(t, { method: "POST", url: "/v1/access-grants", as: staff, body: { email, role: "client", jobId } });
  const list = (who: SignedIn | undefined, query = "") =>
    apiRequest(t, { url: `/v1/access-grants${query}`, ...(who ? { as: who } : {}) });
  const revoke = (who: SignedIn | undefined, id: string) =>
    apiRequest(t, { method: "DELETE", url: `/v1/access-grants/${id}`, ...(who ? { as: who } : {}) });
  const audits = (id: string) =>
    t.db
      .selectFrom("audit_events")
      .selectAll()
      .where("action", "=", "access_grant.revoked")
      .where("entity_id", "=", id)
      .execute();

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, staff, client] = [await as("admin"), await as("staff"), await as("external")];
  });
  afterAll(async () => {
    await t.close();
  });

  it("is for staff roles only", async () => {
    expect((await list(client)).statusCode).toBe(403);
    expect((await list(undefined)).statusCode).toBe(401);
    expect((await revoke(client, UNKNOWN)).statusCode).toBe(403);
    expect((await revoke(undefined, UNKNOWN)).statusCode).toBe(401);
    expect((await revoke(staff, UNKNOWN)).statusCode).toBe(404);
  });

  it("lists by job number then email, hides revoked grants, filters by job and status, and pages with a cursor", async () => {
    const [a, b] = [await f.makeJob({ jobNumber: "ZL-0001" }), await f.makeJob({ jobNumber: "ZL-0002" })];
    const made: Grant[] = [];
    for (const [job, email] of [
      [b, "a@e.test"],
      [a, "c@e.test"],
      [a, "b@e.test"],
      [b, "z@e.test"],
    ] as const) {
      made.push((await create(job.id, email)).json<Grant>());
    }
    await revoke(staff, made[3]!.id);

    const seen: Grant[] = [];
    let cursor: string | null = null;
    do {
      const page: Page = (await list(staff, `?limit=2${cursor ? `&cursor=${cursor}` : ""}`)).json<Page>();
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.filter((g) => g.jobNumber.startsWith("ZL-")).map((g) => `${g.jobNumber} ${g.email}`)).toEqual([
      "ZL-0001 b@e.test",
      "ZL-0001 c@e.test",
      "ZL-0002 a@e.test",
    ]);
    const emails = async (query: string) => (await list(staff, query)).json<Page>().items.map((g) => g.email);
    expect(await emails(`?jobId=${a.id}`)).toEqual(["b@e.test", "c@e.test"]);
    expect(await emails(`?jobId=${b.id}&status=revoked`)).toEqual(["z@e.test"]);
    expect(await emails(`?jobId=${b.id}&status=active`)).toEqual([]);
    expect((await list(staff, "?cursor=bad")).statusCode).toBe(400);
  });

  it("does not list grants of an archived job", async () => {
    const job = await f.makeJob();
    await create(job.id, "gone@e.test");
    await t.db.updateTable("jobs").set({ deleted_at: new Date() }).where("id", "=", job.id).execute();
    expect((await list(staff, `?jobId=${job.id}`)).json<Page>().items).toEqual([]);
  });

  it("revocation is effective on the user's next request, is audited, and is idempotent", async () => {
    const guest = await signIn(t, await f.makeUser({ role: "external", email: "leaver@example.test" }));
    const job = await f.makeJob();
    const grant = (await create(job.id, "leaver@example.test")).json<Grant>();
    const read = () => apiRequest(t, { url: `/v1/jobs/${job.id}`, as: guest });
    expect((await read()).statusCode).toBe(200);
    expect((await revoke(staff, grant.id)).statusCode).toBe(204);
    expect((await read()).statusCode).toBe(404);
    expect((await revoke(admin, grant.id)).statusCode).toBe(204);
    const events = await audits(grant.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor_user_id: staff.user.id,
      job_id: job.id,
      changes: { status: { from: "active", to: "revoked" } },
    });
    const row = await t.db.selectFrom("access_grants").selectAll().where("id", "=", grant.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: "revoked", revoked_by: staff.user.id, revoked_at: t.deps.clock.now() });
  });
});
