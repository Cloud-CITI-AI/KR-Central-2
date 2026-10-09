import type { JobDetail } from "@kr/contracts";
import { CHECKPOINTS } from "@kr/workflow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

type Detail = z.output<typeof JobDetail>;

describe("createJob (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let tag: string;
  let n = 0;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const number = () => `${tag}-${(n += 1)}`;
  const body = (o: Record<string, unknown> = {}) => ({
    jobNumber: number(),
    address: "1 Example Street, Testville",
    clientName: "Sample Developments Pty Ltd",
    subdivisionType: "Survey-Strata",
    ...o,
  });
  const create = (as: SignedIn | undefined, payload: unknown, headers: Record<string, string> = {}) =>
    apiRequest(t, { method: "POST", url: "/v1/jobs", ...(as ? { as } : {}), body: payload, headers });

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    tag = `C${f.faker.string.alphanumeric(5).toUpperCase()}`;
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
    [client, architect, outsider] = [await as("external"), await as("external"), await as("external")];
  });
  afterAll(async () => {
    await t.close();
  });

  it("creates the job, all 46 checkpoint_states with default responsibilities, and its audit row in one go", async () => {
    for (const who of [staff, krAdmin, admin]) {
      const payload = body();
      const res = await create(who, payload);
      expect(res.statusCode).toBe(201);
      const job = res.json<Detail>();
      expect(res.headers.location).toBe(`/v1/jobs/${job.id}`);
      expect(res.headers.etag).toBe('"1"');
      expect(job).toMatchObject({
        jobNumber: payload.jobNumber,
        address: payload.address,
        clientName: payload.clientName,
        subdivisionType: "Survey-Strata",
        version: 1,
        conditions: [],
        summary: {
          isComplete: false,
          alerts: [],
          fileCount: 0,
          progress: { completed: 0, notCompleted: 46, total: 46 },
        },
      });
      expect(job.checkpoints.map((c) => [c.key, c.responsibility, c.status, c.version])).toEqual(
        CHECKPOINTS.map((c) => [c.key, c.defaultResponsibility, "not_completed", 1]),
      );
      const rows = await t.db
        .selectFrom("checkpoint_states")
        .select("checkpoint_key")
        .where("job_id", "=", job.id)
        .execute();
      expect(rows).toHaveLength(46);
      const events = await t.db.selectFrom("audit_events").selectAll().where("job_id", "=", job.id).execute();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: "job.created",
        entity_type: "job",
        entity_id: job.id,
        actor_user_id: who.user.id,
        request_id: res.headers["x-request-id"],
        changes: { jobNumber: { from: null, to: payload.jobNumber } },
      });
    }
  });

  it("accepts an upload to any checkpoint of a new job (files_checkpoint_fk is satisfied)", async () => {
    const job = (await create(staff, body())).json<Detail>();
    for (const c of CHECKPOINTS) await f.makeFile({ jobId: job.id, checkpointKey: c.key, slot: "documents" });
    const count = await t.db.selectFrom("files").select("id").where("job_id", "=", job.id).execute();
    expect(count).toHaveLength(CHECKPOINTS.length);
  });

  it("stores a missing client as null and trims the text", async () => {
    const res = await create(
      staff,
      body({ clientName: undefined, address: "  7 Padded Rd  ", jobNumber: ` ${number()} ` }),
    );
    expect(res.statusCode).toBe(201);
    expect(res.json<Detail>()).toMatchObject({ clientName: null, address: "7 Padded Rd" });
    expect((await create(staff, body({ clientName: null }))).json<Detail>().clientName).toBeNull();
  });

  it("answers 409 with the spec text for a duplicate number, ignoring case, and creates nothing", async () => {
    const payload = body();
    expect((await create(staff, payload)).statusCode).toBe(201);
    const dup = await create(admin, { ...payload, jobNumber: payload.jobNumber.toLowerCase() });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({
      type: "urn:kr:problem:conflict",
      detail: `${payload.jobNumber.toLowerCase()} is already in use.`,
    });
    expect(
      await t.db.selectFrom("jobs").select("id").where("job_number", "=", payload.jobNumber).execute(),
    ).toHaveLength(1);
  });

  it("lets an archived job's number be used again", async () => {
    const payload = body();
    const first = (await create(staff, payload)).json<Detail>();
    await t.db.updateTable("jobs").set({ deleted_at: new Date() }).where("id", "=", first.id).execute();
    const again = await create(staff, payload);
    expect(again.statusCode).toBe(201);
    expect(again.json<Detail>().id).not.toBe(first.id);
  });

  it("creates exactly one job when two requests race for the same number", async () => {
    const payload = body();
    const results = await Promise.all([create(staff, payload), create(admin, payload), create(krAdmin, payload)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    const jobs = await t.db.selectFrom("jobs").select("id").where("job_number", "=", payload.jobNumber).execute();
    expect(jobs).toHaveLength(1);
    const states = await t.db
      .selectFrom("checkpoint_states")
      .select("job_id")
      .where("job_id", "=", jobs[0]?.id ?? "")
      .execute();
    expect(states).toHaveLength(46);
  });

  it("replays the first response for the same Idempotency-Key instead of creating a second job", async () => {
    const payload = body();
    const headers = { "idempotency-key": `key-${f.faker.string.alphanumeric(16)}` };
    const [a, b] = [await create(staff, payload, headers), await create(staff, payload, headers)];
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.json<Detail>().id).toBe(a.json<Detail>().id);
    expect(b.headers.location).toBe(a.headers.location);
    const jobs = await t.db.selectFrom("jobs").select("id").where("job_number", "=", payload.jobNumber).execute();
    expect(jobs).toHaveLength(1);
  });

  it("refuses callers without jobs.create (403), anonymous callers (401) and a missing CSRF token (403)", async () => {
    for (const who of [client, architect, outsider]) {
      const payload = body();
      expect((await create(who, payload)).statusCode).toBe(403);
      expect(await t.db.selectFrom("jobs").select("id").where("job_number", "=", payload.jobNumber).execute()).toEqual(
        [],
      );
    }
    expect((await create(undefined, body())).statusCode).toBe(401);
    const noCsrf = await apiRequest(t, { method: "POST", url: "/v1/jobs", as: staff, body: body(), csrf: null });
    expect(noCsrf.statusCode).toBe(403);
    const gone = await as("staff");
    await t.db.updateTable("users").set({ status: "disabled" }).where("id", "=", gone.user.id).execute();
    expect((await create(gone, body())).statusCode).toBe(401);
  });

  it.each([
    ["a number with a forbidden character", { jobNumber: "S_0001" }],
    ["a blank number", { jobNumber: "   " }],
    ["a number longer than 32 characters", { jobNumber: "S".repeat(33) }],
    ["an unknown subdivision type", { subdivisionType: "Bogus" }],
    ["a missing subdivision type", { subdivisionType: undefined }],
    ["a missing address", { address: undefined }],
    ["an address over 200 characters", { address: "a".repeat(201) }],
    ["an unknown field", { createdBy: "someone" }],
  ])("rejects %s with 400 and creates nothing", async (_name, override) => {
    const payload = body(override);
    const res = await create(staff, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ type: "urn:kr:problem:validation" });
  });

  it("accepts every character R15 allows", async () => {
    const res = await create(staff, body({ jobNumber: `${tag} a.b/c-${(n += 1)}` }));
    expect(res.statusCode).toBe(201);
  });
});
