import type { AuditEvent } from "@kr/contracts";
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
import { listAuditRows } from "../data/audit-events.js";
import { occurredRange } from "../domain/audit-filters.js";

type Event = z.output<typeof AuditEvent>;
interface Page {
  items: Event[];
  nextCursor: string | null;
}

describe("audit trail (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") =>
    signIn(t, await f.makeUser({ role }), { amr: ["pwd", "mfa"] });
  const list = (who: SignedIn | undefined, query = "") =>
    apiRequest(t, { url: `/v1/audit-events${query}`, ...(who ? { as: who } : {}) });
  const put = (actor: string | null, action: string, o: { jobId?: string; at?: string } = {}) =>
    t.db
      .insertInto("audit_events")
      .values({
        actor_user_id: actor,
        actor_type: actor ? "user" : "system",
        action,
        entity_type: "test",
        entity_id: "e1",
        job_id: o.jobId ?? null,
        request_id: "req-1",
        changes: JSON.stringify({ field: { from: 1, to: 2 } }),
        ...(o.at ? { occurred_at: new Date(o.at) } : {}),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

  beforeAll(async () => {
    t = await createTestApp({ config: testConfig({ REQUIRE_MFA_FOR_ADMIN: "true" }) });
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
  });
  afterAll(async () => {
    await t.close();
  });

  it("is for admin and kr_admin with MFA evidence only", async () => {
    expect((await list(admin)).statusCode).toBe(200);
    expect((await list(krAdmin)).statusCode).toBe(200);
    for (const who of [staff, await as("external")]) expect((await list(who)).statusCode).toBe(403);
    expect((await list(undefined)).statusCode).toBe(401);
    for (const user of [admin.user, krAdmin.user]) {
      const res = await list(await signIn(t, user, { amr: ["pwd"] }));
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ detail: "Multi-factor sign-in required" });
    }
  });

  it("lists newest first with the actor's name, the system actor as null, and the changes", async () => {
    const actor = await f.makeUser({ role: "staff", displayName: "Aud Itor" });
    const job = await f.makeJob();
    await put(actor.id, "note.created", { jobId: job.id });
    await put(null, "job.archived", { jobId: job.id });
    const { items } = (await list(admin, `?jobId=${job.id}`)).json<Page>();
    expect(items.map((e) => [e.action, e.actor, e.actorType])).toEqual([
      ["job.archived", null, "system"],
      ["note.created", { id: actor.id, displayName: "Aud Itor" }, "user"],
    ]);
    expect(items[1]).toMatchObject({
      jobId: job.id,
      entityType: "test",
      entityId: "e1",
      requestId: "req-1",
      changes: { field: { from: 1, to: 2 } },
      id: expect.stringMatching(/^\d+$/),
    });
  });

  it("names the job by its number (null without a job), also after the job was archived", async () => {
    const live = await f.makeJob();
    const archived = await f.makeJob({ deletedAt: new Date() });
    await put(null, "job.created", { jobId: live.id });
    await put(null, "job.archived", { jobId: archived.id });
    await put(null, "user.created");
    const byId = async (jobId: string) => (await list(admin, `?jobId=${jobId}`)).json<Page>().items[0];
    expect(await byId(live.id)).toMatchObject({ jobId: live.id, jobNumber: live.job_number });
    expect(await byId(archived.id)).toMatchObject({ jobId: archived.id, jobNumber: archived.job_number });
    const noJob = (await list(admin, "?action=user.created")).json<Page>().items[0];
    expect(noJob).toMatchObject({ jobId: null, jobNumber: null });
  });

  it("filters by job, actor and action prefix (underscores are literal) and combines them", async () => {
    const [one, two] = [await f.makeUser({ role: "staff" }), await f.makeUser({ role: "staff" })];
    const job = await f.makeJob();
    await put(one.id, "access_grant.created", { jobId: job.id });
    await put(one.id, "accessxgrant.created", { jobId: job.id });
    await put(two.id, "access_grant.revoked");
    await put(two.id, "checkpoint.status_changed", { jobId: job.id });
    const actions = async (query: string) =>
      (await list(krAdmin, query))
        .json<Page>()
        .items.map((e) => e.action)
        .sort();
    expect(await actions(`?actorId=${one.id}`)).toEqual(["access_grant.created", "accessxgrant.created"]);
    expect(await actions(`?actorId=${one.id}&action=access_grant.`)).toEqual(["access_grant.created"]);
    expect(await actions(`?actorId=${two.id}&action=access`)).toEqual(["access_grant.revoked"]);
    expect(await actions(`?jobId=${job.id}&actorId=${two.id}`)).toEqual(["checkpoint.status_changed"]);
    expect(await actions(`?jobId=${job.id}&action=checkpoint.`)).toEqual(["checkpoint.status_changed"]);
    expect(await actions(`?actorId=${one.id}&action=%25`)).toEqual([]);
  });

  it("pages newest first with a cursor and rejects a bad one", async () => {
    const actor = await f.makeUser({ role: "staff" });
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.unshift((await put(actor.id, "note.created")).id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Page = (
        await list(admin, `?actorId=${actor.id}&limit=2${cursor ? `&cursor=${cursor}` : ""}`)
      ).json<Page>();
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(ids);
    for (const bad of ["nope", Buffer.from("12x").toString("base64url")]) {
      expect((await list(admin, `?cursor=${bad}`)).statusCode).toBe(400);
    }
  });

  it("filters by Perth calendar dates: a Perth day runs from 16:00 UTC to 16:00 UTC, bounds inclusive of the whole day", async () => {
    const actor = await f.makeUser({ role: "staff" });
    for (const [i, at] of [
      "2026-03-01T15:59:59Z",
      "2026-03-01T16:00:00Z",
      "2026-03-02T15:59:59Z",
      "2026-03-02T16:00:00Z",
    ].entries()) {
      await put(actor.id, `day.${"abcd"[i]}`, { at });
    }
    const days = async (from?: string, to?: string) =>
      (
        await listAuditRows(t.db, {
          jobId: undefined,
          actorId: actor.id,
          actionPrefix: undefined,
          range: occurredRange(from, to),
          beforeId: null,
          limit: 100,
        })
      )
        .map((r) => r.row.occurred_at.toISOString())
        .reverse();
    expect(await days("2026-03-02", "2026-03-02")).toEqual(["2026-03-01T16:00:00.000Z", "2026-03-02T15:59:59.000Z"]);
    expect(await days("2026-03-02")).toEqual([
      "2026-03-01T16:00:00.000Z",
      "2026-03-02T15:59:59.000Z",
      "2026-03-02T16:00:00.000Z",
    ]);
    expect(await days(undefined, "2026-03-01")).toEqual(["2026-03-01T15:59:59.000Z"]);
    expect(await days()).toHaveLength(4);
  });

  it("applies the Perth date range through the HTTP route and rejects a reversed or malformed one with 400", async () => {
    const actor = await f.makeUser({ role: "staff" });
    await put(actor.id, "http.before", { at: "2026-04-01T15:59:59Z" });
    await put(actor.id, "http.in", { at: "2026-04-01T16:00:00Z" });
    await put(actor.id, "http.after", { at: "2026-04-02T16:00:00Z" });
    const actions = async (query: string) =>
      (await list(admin, `?actorId=${actor.id}${query}`)).json<Page>().items.map((e) => e.action);
    expect(await actions("&from=2026-04-02&to=2026-04-02")).toEqual(["http.in"]);
    expect(await actions("&from=2026-04-02")).toEqual(["http.after", "http.in"]);
    expect(await actions("&to=2026-04-01")).toEqual(["http.before"]);
    for (const bad of ["&from=2026-04-03&to=2026-04-02", "&from=2026-13-01", "&to=yesterday"]) {
      expect((await list(admin, `?actorId=${actor.id}${bad}`)).statusCode, bad).toBe(400);
    }
  });
});
