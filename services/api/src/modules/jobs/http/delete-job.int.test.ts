import type { JobDetail, JobPage } from "@kr/contracts";
import type { JobRow } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

describe("deleteJob = archive (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const fresh = async () => {
    const job = await f.makeJob();
    await f.makeGrant({ jobId: job.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: job.id, userId: architect.user.id, role: "architect" });
    return job;
  };
  const del = (who: SignedIn | undefined, job: Pick<JobRow, "id">, version: number | null = 1) =>
    apiRequest(t, {
      method: "DELETE",
      url: `/v1/jobs/${job.id}`,
      ...(who ? { as: who } : {}),
      headers: version === null ? {} : { "if-match": `"${version}"` },
    });
  const row = (id: string) => t.db.selectFrom("jobs").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  const audits = (id: string) =>
    t.db.selectFrom("audit_events").selectAll().where("job_id", "=", id).where("action", "=", "job.archived").execute();

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
    [client, architect, outsider] = [await as("external"), await as("external"), await as("external")];
  });
  afterAll(async () => {
    await t.close();
  });

  it("archives for admin and kr_admin: 204, soft delete with actor and time, version bumped, audit row", async () => {
    for (const who of [admin, krAdmin]) {
      const job = await fresh();
      const res = await del(who, job);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");
      expect(await row(job.id)).toMatchObject({
        deleted_by: who.user.id,
        deleted_at: t.deps.clock.now(),
        version: 2,
      });
      const [event, ...rest] = await audits(job.id);
      expect(rest).toEqual([]);
      expect(event).toMatchObject({
        actor_user_id: who.user.id,
        entity_id: job.id,
        request_id: res.headers["x-request-id"],
        changes: { archived: { from: false, to: true } },
      });
    }
  });

  it("refuses staff, client and architect (403) and callers who cannot see the job (404), changing nothing", async () => {
    const job = await fresh();
    for (const who of [staff, client, architect]) expect((await del(who, job)).statusCode).toBe(403);
    expect((await del(outsider, job)).statusCode).toBe(404);
    expect((await del(undefined, job)).statusCode).toBe(401);
    const noCsrf = await apiRequest(t, {
      method: "DELETE",
      url: `/v1/jobs/${job.id}`,
      as: admin,
      csrf: null,
      headers: { "if-match": '"1"' },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(await row(job.id)).toMatchObject({ deleted_at: null, version: 1 });
    expect(await audits(job.id)).toEqual([]);
  });

  it("removes the job from every list, from getJob and from the grants of externals", async () => {
    const job = await fresh();
    const visibleTo = async (who: SignedIn) => {
      const list = await apiRequest(t, { url: `/v1/jobs?status=all&q=${job.job_number}`, as: who });
      const ids = list.json<z.output<typeof JobPage>>().items.map((i) => i.id);
      const detail = await apiRequest(t, { url: `/v1/jobs/${job.id}`, as: who });
      expect(detail.statusCode).toBe(ids.includes(job.id) ? 200 : 404);
      return ids.includes(job.id);
    };
    for (const who of [admin, krAdmin, staff, client, architect]) expect(await visibleTo(who)).toBe(true);
    const facetsBefore = (await apiRequest(t, { url: "/v1/jobs/facets?status=all", as: client })).json<{
      statusCounts: { all: number };
    }>();
    expect((await del(admin, job)).statusCode).toBe(204);
    for (const who of [admin, krAdmin, staff, client, architect]) expect(await visibleTo(who)).toBe(false);
    const facetsAfter = (await apiRequest(t, { url: "/v1/jobs/facets?status=all", as: client })).json<{
      statusCounts: { all: number };
    }>();
    expect(facetsAfter.statusCounts.all).toBe(facetsBefore.statusCounts.all - 1);
  });

  it("keeps the job's states, files and grants, and no longer accepts writes to it", async () => {
    const job = await fresh();
    const file = await f.makeFile({ jobId: job.id });
    expect((await del(admin, job)).statusCode).toBe(204);
    expect(
      await t.db.selectFrom("checkpoint_states").select("job_id").where("job_id", "=", job.id).execute(),
    ).toHaveLength(46);
    expect((await t.db.selectFrom("files").select("id").where("id", "=", file.id).executeTakeFirst())?.id).toBe(
      file.id,
    );
    expect(
      await t.db
        .selectFrom("access_grants")
        .select("id")
        .where("job_id", "=", job.id)
        .where("status", "=", "active")
        .execute(),
    ).toHaveLength(2);
    expect((await del(admin, job, 2)).statusCode).toBe(404);
    const edit = await apiRequest(t, {
      method: "PATCH",
      url: `/v1/jobs/${job.id}`,
      as: staff,
      body: { address: "x" },
      headers: { "if-match": '"2"' },
    });
    expect(edit.statusCode).toBe(404);
  });

  it("frees the job number for a new job", async () => {
    const job = await fresh();
    await del(admin, job);
    const res = await apiRequest(t, {
      method: "POST",
      url: "/v1/jobs",
      as: staff,
      body: { jobNumber: job.job_number, address: "1 New Street", subdivisionType: "Freehold" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<z.output<typeof JobDetail>>().id).not.toBe(job.id);
  });

  it("requires If-Match: missing 428, stale 412 (job stays active), current 204", async () => {
    const job = await fresh();
    expect((await del(admin, job, null)).statusCode).toBe(428);
    await apiRequest(t, {
      method: "PATCH",
      url: `/v1/jobs/${job.id}`,
      as: staff,
      body: { address: "edited" },
      headers: { "if-match": '"1"' },
    });
    const stale = await del(admin, job, 1);
    expect(stale.statusCode).toBe(412);
    expect(await row(job.id)).toMatchObject({ deleted_at: null, version: 2 });
    expect(await audits(job.id)).toEqual([]);
    expect((await del(admin, job, 2)).statusCode).toBe(204);
  });

  it("archives once when two admins race, and answers 400 for a malformed id", async () => {
    const job = await fresh();
    const results = await Promise.all([del(admin, job), del(krAdmin, job)]);
    const codes = results.map((r) => r.statusCode).sort();
    // The loser is a 404 (it lost the row lock after the job was archived) or a 412 (its pre-check ran before the commit).
    expect(codes[0]).toBe(204);
    expect([404, 412]).toContain(codes[1]);
    expect(await audits(job.id)).toHaveLength(1);
    expect(
      (await apiRequest(t, { method: "DELETE", url: "/v1/jobs/nope", as: admin, headers: { "if-match": '"1"' } }))
        .statusCode,
    ).toBe(400);
  });
});
