import type { JobFacets, JobPage } from "@kr/contracts";
import type { JobRow } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

type Page = z.output<typeof JobPage>;
type Facets = z.output<typeof JobFacets>;

describe("listJobs and getJobFacets (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let tag: string;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  let jobs: Record<"open" | "done" | "expired" | "declined1" | "freehold" | "archived" | "pct", JobRow>;

  const setState = (jobId: string, key: string, set: Record<string, unknown>) =>
    t.db
      .updateTable("checkpoint_states")
      .set(set)
      .where("job_id", "=", jobId)
      .where("checkpoint_key", "=", key)
      .execute();
  const list = async (as: SignedIn, query = "") => {
    const res = await apiRequest(t, { url: `/v1/jobs?${query}`, as });
    return { res, page: res.json<Page>() };
  };
  const mine = (query = "") => `q=${tag}&${query}`;

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    tag = `L${f.faker.string.alphanumeric(5).toUpperCase()}`;
    const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
    admin = await as("admin");
    krAdmin = await as("kr_admin");
    staff = await as("staff");
    client = await as("external");
    architect = await as("external");
    outsider = await as("external");
    const make = (suffix: string, extra: Partial<Pick<JobRow, "deleted_at">> = {}) =>
      f.makeJob({ jobNumber: `${tag}-${suffix}`, deletedAt: extra.deleted_at ?? null });
    jobs = {
      open: await make("010"),
      done: await make("002"),
      expired: await make("100"),
      declined1: await make("020"),
      freehold: await make("003"),
      archived: await make("004", { deleted_at: new Date() }),
      pct: await make("005"),
    };
    await t.db
      .updateTable("jobs")
      .set({ subdivision_type: "Survey-Strata" })
      .where(
        "id",
        "in",
        Object.values(jobs).map((j) => j.id),
      )
      .execute();
    await setState(jobs.done.id, "i13_2", { status: "completed" });
    await t.db.updateTable("jobs").set({ approval_expiry: "2026-01-01" }).where("id", "=", jobs.expired.id).execute();
    await setState(jobs.expired.id, "i3_0p", {
      decision: "declined",
      decision_comment: "Too high",
      decided_at: new Date("2026-02-01T00:00:00Z"),
    });
    await setState(jobs.declined1.id, "i1_0p", {
      decision: "declined",
      decision_comment: "Too high",
      decided_at: new Date("2026-02-01T00:00:00Z"),
    });
    await t.db.updateTable("jobs").set({ subdivision_type: "Freehold" }).where("id", "=", jobs.freehold.id).execute();
    await t.db.updateTable("jobs").set({ subdivision_type: "Built Strata" }).where("id", "=", jobs.open.id).execute();
    await t.db
      .updateTable("jobs")
      .set({ address: "5 Fifty%_Percent Lane, Testville", client_name: null })
      .where("id", "=", jobs.pct.id)
      .execute();
    await f.makeGrant({ jobId: jobs.open.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: jobs.done.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: jobs.archived.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: jobs.expired.id, userId: client.user.id, role: "client", status: "revoked" });
    await f.makeGrant({ jobId: jobs.open.id, userId: architect.user.id, role: "architect" });
  });
  afterAll(async () => {
    await t.close();
  });

  it("shows staff, kr_admin and admin every active job and hides archived ones from all of them", async () => {
    for (const who of [staff, krAdmin, admin]) {
      const { res, page } = await list(who, mine("status=all"));
      expect(res.statusCode).toBe(200);
      expect(page.items.map((i) => i.jobNumber).sort()).toEqual(
        [jobs.open, jobs.done, jobs.expired, jobs.declined1, jobs.freehold, jobs.pct].map((j) => j.job_number).sort(),
      );
      expect(page.nextCursor).toBeNull();
    }
  });

  it("shows externals only jobs with an active grant on a non-archived job", async () => {
    const { page } = await list(client, "status=all");
    expect(page.items.map((i) => i.id).sort()).toEqual([jobs.open.id, jobs.done.id].sort());
    expect((await list(architect, "status=all")).page.items.map((i) => i.id)).toEqual([jobs.open.id]);
    const none = await list(outsider, "status=all");
    expect(none.res.statusCode).toBe(200);
    expect(none.page).toEqual({ items: [], nextCursor: null });
  });

  it("answers 401 without a session and for a disabled user", async () => {
    expect((await apiRequest(t, { url: "/v1/jobs" })).statusCode).toBe(401);
    const gone = await signIn(t, await f.makeUser({ role: "staff" }));
    await t.db.updateTable("users").set({ status: "disabled" }).where("id", "=", gone.user.id).execute();
    expect((await apiRequest(t, { url: "/v1/jobs", as: gone })).statusCode).toBe(401);
    expect((await apiRequest(t, { url: "/v1/jobs/facets", as: gone })).statusCode).toBe(401);
  });

  it("computes progress, next actions, alerts and waiting-on-client with @kr/workflow", async () => {
    const { page } = await list(admin, mine("status=all"));
    const byId = new Map(page.items.map((i) => [i.id, i]));
    const open = byId.get(jobs.open.id)!;
    expect(open).toMatchObject({
      jobNumber: jobs.open.job_number,
      isComplete: false,
      isWaitingOnClient: true,
      progress: { completed: 0, notRequired: 0, notCompleted: 46, total: 46, percent: 0 },
      nextActions: [{ checkpointKey: "i1_0p", number: "1.0", responsibility: "client" }],
      alerts: [],
      subdivisionType: "Built Strata",
    });
    const done = byId.get(jobs.done.id)!;
    expect(done).toMatchObject({ isComplete: true, isWaitingOnClient: false, progress: { completed: 1, percent: 2 } });
    const expired = byId.get(jobs.expired.id)!;
    expect(expired.alerts.map((a) => a.code)).toEqual(["approval_expired", "client_declined"]);
    expect(expired.alerts[1]?.text).toBe("Client declined the WAPC proposal (3.0)");
  });

  it("filters by status: in_progress is the default, complete and all are explicit", async () => {
    const ids = async (q: string) => (await list(admin, mine(q))).page.items.map((i) => i.id);
    expect(await ids("")).not.toContain(jobs.done.id);
    expect(await ids("status=complete")).toEqual([jobs.done.id]);
    expect(await ids("status=all")).toContain(jobs.done.id);
    expect((await ids("status=in_progress")).length).toBe(5);
  });

  it("filters by subdivision type and rejects an unknown one", async () => {
    expect((await list(admin, mine("type=Freehold"))).page.items.map((i) => i.id)).toEqual([jobs.freehold.id]);
    expect((await apiRequest(t, { url: "/v1/jobs?type=Bogus", as: admin })).statusCode).toBe(400);
  });

  it("searches job number, address and client name case-insensitively, with wildcards matched literally", async () => {
    const ids = async (q: string) =>
      (await list(admin, `q=${encodeURIComponent(q)}&status=all`)).page.items.map((i) => i.id);
    expect(await ids(jobs.open.job_number.toLowerCase())).toEqual([jobs.open.id]);
    expect(await ids(jobs.open.address.slice(2, 12).toUpperCase())).toContain(jobs.open.id);
    expect(await ids(jobs.open.client_name?.slice(0, 8).toLowerCase() ?? "")).toContain(jobs.open.id);
    expect(await ids("Fifty%_Percent")).toEqual([jobs.pct.id]);
    expect(await ids("%")).toEqual([jobs.pct.id]);
    expect(await ids("_")).toEqual([jobs.pct.id]);
    expect(await ids("\\")).toEqual([]);
    expect(await ids("Fifty__ercent")).toEqual([]);
  });

  it("only lets search find jobs the caller can see", async () => {
    const res = await list(client, `q=${tag}&status=all`);
    expect(res.page.items.map((i) => i.id).sort()).toEqual([jobs.open.id, jobs.done.id].sort());
  });

  it("sorts by attention (most alerts first, then natural job number) or by job number", async () => {
    const att = (await list(admin, mine("status=all"))).page.items.map((i) => i.jobNumber.slice(tag.length + 1));
    expect(att).toEqual(["100", "020", "002", "003", "005", "010"]);
    const num = (await list(admin, mine("status=all&sort=job_number"))).page.items.map((i) =>
      i.jobNumber.slice(tag.length + 1),
    );
    expect(num).toEqual(["002", "003", "005", "010", "020", "100"]);
  });

  it("hides the fee proposal decision, and the alert derived from it, from callers without fee_proposal.view", async () => {
    const alertsOf = async (who: SignedIn) =>
      (await list(who, mine("status=all"))).page.items.find((i) => i.id === jobs.declined1.id)?.alerts ?? [];
    expect(await alertsOf(staff)).toEqual([]);
    expect(await alertsOf(architect)).toEqual([]);
    for (const who of [krAdmin, admin]) {
      expect((await alertsOf(who)).map((a) => a.text)).toEqual(["Client declined the fee proposal (1.0)"]);
    }
  });

  it("pages with an opaque cursor in a stable total order, at most `limit` per page", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const { page, res } = await list(admin, mine(`status=all&limit=2${cursor ? `&cursor=${cursor}` : ""}`));
      expect(res.statusCode).toBe(200);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    const whole = (await list(admin, mine("status=all"))).page.items.map((i) => i.id);
    expect(seen).toEqual(whole);
    const numbered: string[] = [];
    let next: string | null = null;
    do {
      const { page } = await list(admin, mine(`status=all&sort=job_number&limit=4${next ? `&cursor=${next}` : ""}`));
      numbered.push(...page.items.map((i) => i.jobNumber));
      next = page.nextCursor;
    } while (next);
    expect(numbered).toHaveLength(6);
  });

  it("rejects a malformed cursor, a cursor of the other sort, and a limit above 100", async () => {
    const first = (await list(admin, mine("status=all&limit=1"))).page.nextCursor ?? "";
    expect((await list(admin, mine(`cursor=not-a-cursor`))).res.statusCode).toBe(400);
    expect((await list(admin, mine(`status=all&sort=job_number&cursor=${first}`))).res.statusCode).toBe(400);
    expect((await list(admin, mine("limit=101"))).res.statusCode).toBe(400);
    expect((await list(admin, mine("limit=0"))).res.statusCode).toBe(400);
  });

  describe("facets", () => {
    const facets = async (who: SignedIn, status = "") => {
      const res = await apiRequest(t, { url: `/v1/jobs/facets${status ? `?status=${status}` : ""}`, as: who });
      expect(res.statusCode).toBe(200);
      return res.json<Facets>();
    };

    it("counts exactly what an external caller sees, by status and within the status filter by type", async () => {
      expect(await facets(client)).toEqual({
        statusCounts: { in_progress: 1, complete: 1, all: 2 },
        typeCounts: {
          "": 1,
          "Survey-Strata": 0,
          "Built Strata": 1,
          Amalgamation: 0,
          Freehold: 0,
          "Strata Conversion": 0,
          "Re-Subdivision": 0,
        },
        waitingOnClient: 1,
        needAttention: 0,
      });
      const all = await facets(client, "all");
      expect(all.typeCounts[""]).toBe(2);
      expect((await facets(client, "complete")).typeCounts[""]).toBe(1);
      expect(await facets(outsider)).toMatchObject({ statusCounts: { in_progress: 0, complete: 0, all: 0 } });
    });

    it("keeps its numbers consistent with listJobs", async () => {
      // An external caller's grants isolate it from the jobs other test files create at the same time.
      const watcher = await signIn(t, await f.makeUser({ role: "external" }));
      for (const j of [jobs.open, jobs.done, jobs.expired, jobs.declined1]) {
        await f.makeGrant({ jobId: j.id, userId: watcher.user.id, role: "client" });
      }
      const counts = await facets(watcher, "all");
      const inProgress = (await list(watcher, "status=in_progress")).page.items;
      const complete = (await list(watcher, "status=complete")).page.items;
      expect(counts.statusCounts).toEqual({ in_progress: 3, complete: 1, all: 4 });
      expect([inProgress.length, complete.length]).toEqual([3, 1]);
      expect(counts.waitingOnClient).toBe(inProgress.filter((i) => i.isWaitingOnClient).length);
      expect(counts.needAttention).toBe([...inProgress, ...complete].filter((i) => i.alerts.length > 0).length);
      expect([counts.waitingOnClient, counts.needAttention]).toEqual([3, 2]);
      const staffCounts = await facets(staff, "all");
      expect(staffCounts.statusCounts.in_progress + staffCounts.statusCounts.complete).toBe(
        staffCounts.statusCounts.all,
      );
      expect(staffCounts.statusCounts.all).toBeGreaterThanOrEqual(6);
    });

    it("counts the fee proposal alert for a client grant but not for an architect grant", async () => {
      const external = async () => signIn(t, await f.makeUser({ role: "external" }));
      const [asClient, asArchitect] = [await external(), await external()];
      await f.makeGrant({ jobId: jobs.declined1.id, userId: asClient.user.id, role: "client" });
      await f.makeGrant({ jobId: jobs.declined1.id, userId: asArchitect.user.id, role: "architect" });
      expect((await facets(asClient)).needAttention).toBe(1);
      expect((await facets(asArchitect)).needAttention).toBe(0);
    });

    it("rejects an unknown status and an unauthenticated caller", async () => {
      expect((await apiRequest(t, { url: "/v1/jobs/facets?status=bogus", as: staff })).statusCode).toBe(400);
      expect((await apiRequest(t, { url: "/v1/jobs/facets" })).statusCode).toBe(401);
    });
  });
});
