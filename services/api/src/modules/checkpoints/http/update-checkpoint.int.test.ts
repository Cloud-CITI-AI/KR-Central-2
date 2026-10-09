import type { CheckpointState } from "@kr/contracts";
import type { JobRow } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

type State = z.output<typeof CheckpointState>;

describe("updateCheckpoint (real Postgres)", () => {
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
  const patch = (
    who: SignedIn | undefined,
    job: Pick<JobRow, "id">,
    key: string,
    body: unknown,
    version: number | string | null = 1,
  ) =>
    apiRequest(t, {
      method: "PATCH",
      url: `/v1/jobs/${job.id}/checkpoints/${key}`,
      ...(who ? { as: who } : {}),
      body,
      headers: version === null ? {} : { "if-match": typeof version === "number" ? `"${version}"` : version },
    });
  const state = (id: string, key: string) =>
    t.db
      .selectFrom("checkpoint_states")
      .selectAll()
      .where("job_id", "=", id)
      .where("checkpoint_key", "=", key)
      .executeTakeFirstOrThrow();
  const jobRow = (id: string) => t.db.selectFrom("jobs").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  const audits = (id: string) =>
    t.db
      .selectFrom("audit_events")
      .selectAll()
      .where("job_id", "=", id)
      .where("entity_type", "=", "checkpoint")
      .orderBy("id")
      .execute();

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
    [client, architect, outsider] = [await as("external"), await as("external"), await as("external")];
  });
  afterAll(async () => {
    await t.close();
  });

  it("changes status, responsibility and KR note for staff, kr_admin and admin, versioned and audited per field", async () => {
    for (const who of [staff, krAdmin, admin]) {
      const job = await fresh();
      const res = await patch(who, job, "i8_3", {
        status: "completed",
        responsibility: "architect",
        krNote: "Contribution payable to the Shire",
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers.etag).toBe('"2"');
      expect(res.json<State>()).toMatchObject({
        key: "i8_3",
        status: "completed",
        storedStatus: "completed",
        responsibility: "architect",
        krNote: "Contribution payable to the Shire",
        version: 2,
        isRestricted: false,
      });
      expect(await state(job.id, "i8_3")).toMatchObject({ version: 2, updated_by: who.user.id });
      const events = await audits(job.id);
      expect(events.map((e) => e.action)).toEqual([
        "checkpoint.status_changed",
        "checkpoint.responsibility_changed",
        "checkpoint.kr_note_changed",
      ]);
      expect(events.every((e) => e.actor_user_id === who.user.id && e.entity_id === "i8_3")).toBe(true);
      expect(events[0]?.changes).toEqual({ status: { from: "not_completed", to: "completed" } });
      expect(events[2]?.changes).toEqual({ krNoteLength: { from: 0, to: 33 } });
      expect(JSON.stringify(events)).not.toContain("Shire");
    }
  });

  it("bumps the job version so its ETag and dashboard card change, and only when something changed", async () => {
    const job = await fresh();
    expect((await jobRow(job.id)).version).toBe(1);
    await patch(staff, job, "i2_0", { status: "completed" });
    expect((await jobRow(job.id)).version).toBe(2);
    const noop = await patch(staff, job, "i2_0", { status: "completed" }, 2);
    expect(noop.statusCode).toBe(200);
    expect(noop.headers.etag).toBe('"2"');
    expect((await jobRow(job.id)).version).toBe(2);
    expect(await audits(job.id)).toHaveLength(1);
    const detail = await apiRequest(t, { url: `/v1/jobs/${job.id}`, as: staff });
    expect(detail.headers.etag).toBe('"2"');
  });

  it("can unassign a responsibility with null", async () => {
    const job = await fresh();
    const res = await patch(staff, job, "i2_0", { responsibility: null });
    expect(res.json<State>().responsibility).toBeNull();
    expect((await state(job.id, "i2_0")).responsibility).toBeNull();
  });

  it("returns the effective status: an agency-excluded checkpoint stays Not required while the stored status is kept", async () => {
    const job = await fresh();
    await f.makeCondition({ jobId: job.id, number: 1, agency: "Western Power" });
    const res = await patch(staff, job, "i7_0", { status: "completed" });
    expect(res.json<State>()).toMatchObject({
      status: "not_required",
      storedStatus: "completed",
      excludedByConditions: true,
    });
  });

  it("refuses client and architect grants with 403, callers who cannot see the job with 404, and writes nothing", async () => {
    const job = await fresh();
    for (const who of [client, architect]) {
      for (const body of [{ status: "completed" }, { responsibility: "kr" }, { krNote: "x" }]) {
        expect((await patch(who, job, "i8_3", body)).statusCode).toBe(403);
      }
    }
    expect((await patch(outsider, job, "i8_3", { status: "completed" })).statusCode).toBe(404);
    expect((await patch(undefined, job, "i8_3", { status: "completed" })).statusCode).toBe(401);
    const noCsrf = await apiRequest(t, {
      method: "PATCH",
      url: `/v1/jobs/${job.id}/checkpoints/i8_3`,
      as: staff,
      csrf: null,
      body: { status: "completed" },
      headers: { "if-match": '"1"' },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(await state(job.id, "i8_3")).toMatchObject({ status: "not_completed", version: 1 });
    expect(await audits(job.id)).toEqual([]);
    expect((await jobRow(job.id)).version).toBe(1);
  });

  it("is 404 for an archived job", async () => {
    const job = await fresh();
    await t.db.updateTable("jobs").set({ deleted_at: new Date() }).where("id", "=", job.id).execute();
    expect((await patch(staff, job, "i2_0", { status: "completed" })).statusCode).toBe(404);
  });

  it("protects the fee proposal: only fee_proposal.view holders with the field capability may edit it", async () => {
    const job = await fresh();
    expect((await patch(staff, job, "i1_0p", { status: "completed" })).statusCode).toBe(403);
    expect((await patch(client, job, "i1_0p", { status: "completed" })).statusCode).toBe(403);
    expect((await state(job.id, "i1_0p")).status).toBe("not_completed");
    const ok = await patch(krAdmin, job, "i1_0p", { status: "completed" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<State>()).toMatchObject({ status: "completed", isRestricted: false });
  });

  it("only accepts a KR note on a checkpoint that has a comment box", async () => {
    const job = await fresh();
    const res = await patch(staff, job, "i2_0", { krNote: "x" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ errors: [{ path: "krNote" }] });
    expect((await state(job.id, "i2_0")).kr_note).toBe("");
  });

  it("requires If-Match on the checkpoint version: 428 missing, 400 malformed, 412 stale with nothing written", async () => {
    const job = await fresh();
    expect((await patch(staff, job, "i2_0", { status: "completed" }, null)).statusCode).toBe(428);
    expect((await patch(staff, job, "i2_0", { status: "completed" }, "abc")).statusCode).toBe(400);
    expect((await patch(staff, job, "i2_0", { status: "completed" }, 4)).statusCode).toBe(412);
    expect(await state(job.id, "i2_0")).toMatchObject({ status: "not_completed", version: 1 });
    expect(await audits(job.id)).toEqual([]);
    expect((await patch(staff, job, "i2_0", { status: "completed" }, 1)).statusCode).toBe(200);
    const stale = await patch(staff, job, "i2_0", { status: "not_completed" }, 1);
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ type: "urn:kr:problem:precondition-failed" });
  });

  it("lets only one of two concurrent edits with the same version win, and edits of other checkpoints are independent", async () => {
    const job = await fresh();
    const [a, b] = await Promise.all([
      patch(staff, job, "i2_0", { status: "completed" }),
      patch(admin, job, "i2_0", { status: "not_required" }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 412]);
    expect((await state(job.id, "i2_0")).version).toBe(2);
    expect((await patch(staff, job, "i4_0", { status: "completed" })).statusCode).toBe(200);
  });

  it("rejects an empty body, unknown fields, bad values and an unknown checkpoint with 400", async () => {
    const job = await fresh();
    for (const body of [
      {},
      { status: "done" },
      { responsibility: "everyone" },
      { krNote: "x".repeat(2001) },
      { version: 2 },
    ]) {
      expect((await patch(staff, job, "i8_3", body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await patch(staff, job, "i99_9", { status: "completed" })).statusCode).toBe(400);
    expect((await state(job.id, "i8_3")).version).toBe(1);
  });
});
