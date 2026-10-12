import type { JobPage } from "@kr/contracts";
import { createPool, type Database, type JobRow } from "@kr/db";
import { Kysely, PostgresDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

type Page = z.output<typeof JobPage>;

/**
 * The list and facets endpoints reuse the summaries of jobs that have not changed (PERF: at the designed 2,000 jobs the
 * old read of ~92,000 checkpoint rows per request put p95 at 2.4 s). These tests pin what that reuse must never change:
 * every write shows in the very next response, and a warm cache answers exactly what a cold process would.
 */
describe("job list summaries are reused between requests (real Postgres)", () => {
  let t: TestApp;
  let cold: TestApp;
  let f: Factories;
  let tag: string;
  let staff: SignedIn, client: SignedIn, architect: SignedIn;
  let coldStaff: SignedIn, coldClient: SignedIn, coldArchitect: SignedIn;
  let jobs: Record<"a" | "b" | "c", JobRow>;
  const queries: { sql: string; parameters: readonly unknown[] }[] = [];
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: createPool({ connectionString: inject("databaseUrl"), applicationName: "kr-api-cache-test" }),
    }),
    log: (event) => {
      if (event.level === "query") queries.push({ sql: event.query.sql, parameters: event.query.parameters });
    },
  });

  /** Ids of the jobs whose checkpoint states / conditions were read row by row (the stamps are grouped, so excluded). */
  const rowReads = (table: "checkpoint_states" | "conditions") =>
    queries
      .filter((q) => q.sql.includes(`from "${table}"`) && !q.sql.includes("group by"))
      .flatMap((q) => q.parameters.filter((p): p is string => typeof p === "string"));
  const list = async (app: TestApp, as: SignedIn, query = "") =>
    (await apiRequest(app, { url: `/v1/jobs?q=${tag}&status=all&${query}`, as })).json<Page>();
  const all = async (app: TestApp, who: [SignedIn, SignedIn, SignedIn]) => {
    const [s, c, a] = who;
    return {
      staff: [await list(app, s, "sort=job_number"), await list(app, s, "sort=attention")],
      client: [await list(app, c, "sort=attention")],
      architect: [await list(app, a, "sort=attention")],
    };
  };

  beforeAll(async () => {
    t = await createTestApp({ db });
    cold = await createTestApp({ db: t.db });
    f = createFactories(t.db);
    tag = `C${f.faker.string.alphanumeric(5).toUpperCase()}`;
    const as = async (app: TestApp, role: "staff" | "external") => signIn(app, await f.makeUser({ role }));
    staff = await as(t, "staff");
    client = await as(t, "external");
    architect = await as(t, "external");
    jobs = {
      a: await f.makeJob({ jobNumber: `${tag}-001` }),
      b: await f.makeJob({ jobNumber: `${tag}-002` }),
      c: await f.makeJob({ jobNumber: `${tag}-003` }),
    };
    for (const job of Object.values(jobs)) {
      await f.makeGrant({ jobId: job.id, userId: client.user.id, role: "client" });
      await f.makeGrant({ jobId: job.id, userId: architect.user.id, role: "architect" });
      await f.makeCondition({ jobId: job.id, number: 1, agency: "Western Power" });
    }
    await db
      .updateTable("checkpoint_states")
      .set({ decision: "declined", decision_comment: "Too high", decided_at: new Date("2026-02-01T00:00:00Z") })
      .where("job_id", "=", jobs.a.id)
      .where("checkpoint_key", "=", "i1_0p")
      .execute();
    // The cold app is a second process: its cache starts empty. Sessions are per app, so sign the same users in again.
    coldStaff = await signIn(cold, staff.user);
    coldClient = await signIn(cold, client.user);
    coldArchitect = await signIn(cold, architect.user);
  });
  afterAll(async () => {
    await cold.close();
    await t.close();
    await db.destroy();
  });

  it("a repeat request reads no checkpoint or condition rows for jobs that did not change", async () => {
    const first = await list(t, staff, "sort=job_number");
    expect(first.items).toHaveLength(3);
    expect(new Set(rowReads("checkpoint_states"))).toEqual(new Set(Object.values(jobs).map((j) => j.id)));
    queries.length = 0;
    expect(await list(t, staff, "sort=job_number")).toEqual(first);
    expect(rowReads("checkpoint_states")).toEqual([]);
    expect(rowReads("conditions")).toEqual([]);
  });

  it("shows a checkpoint write in the next response and re-reads only that job", async () => {
    const before = (await list(t, staff)).items.find((i) => i.id === jobs.b.id)!;
    expect(before.progress.completed).toBe(0);
    queries.length = 0;
    const paid = await apiRequest(t, { method: "PUT", url: `/v1/jobs/${jobs.b.id}/checkpoints/i6_2/paid`, as: staff });
    expect(paid.statusCode).toBe(200);
    queries.length = 0;
    const after = (await list(t, staff)).items.find((i) => i.id === jobs.b.id)!;
    expect(after.progress.completed).toBe(1);
    expect(rowReads("checkpoint_states")).toEqual([jobs.b.id]);
  });

  it("shows a condition write and a replaced set of conditions in the next response", async () => {
    const [condition] = await db.selectFrom("conditions").selectAll().where("job_id", "=", jobs.c.id).execute();
    const cleared = await apiRequest(t, {
      method: "PATCH",
      url: `/v1/jobs/${jobs.c.id}/conditions/${condition!.id}`,
      as: staff,
      body: { isCleared: true },
      headers: { "if-match": `"${condition!.version.toString()}"` },
    });
    expect(cleared.statusCode).toBe(200);
    queries.length = 0;
    await list(t, staff);
    expect(rowReads("conditions")).toEqual([jobs.c.id]);

    // A re-extraction supersedes the current set and inserts a new one (no version of an old row changes).
    await db.updateTable("conditions").set({ superseded_at: new Date() }).where("job_id", "=", jobs.c.id).execute();
    await f.makeCondition({ jobId: jobs.c.id, number: 1, agency: "Water Corporation" });
    queries.length = 0;
    await list(t, staff);
    expect(rowReads("conditions")).toEqual([jobs.c.id]);
    // Superseding without adding anything still changes the current set.
    await db.updateTable("conditions").set({ superseded_at: new Date() }).where("job_id", "=", jobs.c.id).execute();
    queries.length = 0;
    await list(t, staff);
    expect(rowReads("conditions")).toEqual([jobs.c.id]);
  });

  it("answers exactly what a process with an empty cache answers, for every viewer and sort", async () => {
    await all(t, [staff, client, architect]);
    const warm = await all(t, [staff, client, architect]);
    expect(warm).toEqual(await all(cold, [coldStaff, coldClient, coldArchitect]));
  });

  it("never lets a cached summary carry the fee proposal decision to a viewer who may not see it", async () => {
    // Warm the cache as kr_admin (fee_proposal.view: sees the decline and its alert) before staff and the architect ask.
    const krAdmin = await signIn(t, await f.makeUser({ role: "kr_admin" }));
    const codes = async (who: SignedIn) =>
      (await list(t, who, "sort=attention")).items.find((i) => i.id === jobs.a.id)!.alerts.map((a) => a.code);
    expect(await codes(krAdmin)).toContain("client_declined");
    expect(await codes(staff)).not.toContain("client_declined");
    expect(await codes(architect)).not.toContain("client_declined");
    expect(await codes(client)).toContain("client_declined");
    expect(await codes(architect)).not.toContain("client_declined");
  });
});
