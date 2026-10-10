import type { CheckpointState, JobDetail } from "@kr/contracts";
import type { JobRow } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

type State = z.output<typeof CheckpointState>;
type Detail = z.output<typeof JobDetail>;

describe("markPaid and undoPaid (real Postgres)", () => {
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
  const paid = (who: SignedIn | undefined, job: Pick<JobRow, "id">, key: string, method: "PUT" | "DELETE" = "PUT") =>
    apiRequest(t, { method, url: `/v1/jobs/${job.id}/checkpoints/${key}/paid`, ...(who ? { as: who } : {}) });
  const state = (id: string, key: string) =>
    t.db
      .selectFrom("checkpoint_states")
      .selectAll()
      .where("job_id", "=", id)
      .where("checkpoint_key", "=", key)
      .executeTakeFirstOrThrow();
  const audits = (id: string) =>
    t.db
      .selectFrom("audit_events")
      .selectAll()
      .where("job_id", "=", id)
      .where("action", "like", "checkpoint.paid\\_%")
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

  it("the client response button records who and when and sets Completed (R13)", async () => {
    for (const who of [client, staff, krAdmin, admin]) {
      const job = await fresh();
      const res = await paid(who, job, "i6_2");
      expect(res.statusCode).toBe(200);
      expect(res.json<State>()).toMatchObject({
        key: "i6_2",
        status: "completed",
        storedStatus: "completed",
        paid: { at: t.deps.clock.now().toISOString(), by: { id: who.user.id } },
        version: 2,
      });
      expect(await state(job.id, "i6_2")).toMatchObject({ status: "completed", paid_by: who.user.id, version: 2 });
      const [event, ...rest] = await audits(job.id);
      expect(rest).toEqual([]);
      expect(event).toMatchObject({
        action: "checkpoint.paid_recorded",
        actor_user_id: who.user.id,
        entity_id: "i6_2",
        request_id: res.headers["x-request-id"],
        changes: { status: { from: "not_completed", to: "completed" } },
      });
      expect((await apiRequest(t, { url: `/v1/jobs/${job.id}`, as: who })).json<Detail>()).toMatchObject({
        version: 1,
        summary: { progress: { completed: 1, notCompleted: 45 } },
      });
    }
  });

  it("Undo clears the record and sets Not completed", async () => {
    const job = await fresh();
    await paid(client, job, "i14_0");
    const res = await paid(staff, job, "i14_0", "DELETE");
    expect(res.statusCode).toBe(200);
    expect(res.json<State>()).toMatchObject({
      status: "not_completed",
      storedStatus: "not_completed",
      paid: null,
      version: 3,
    });
    expect(await state(job.id, "i14_0")).toMatchObject({ paid_at: null, paid_by: null, status: "not_completed" });
    expect((await audits(job.id)).map((e) => e.action)).toEqual(["checkpoint.paid_recorded", "checkpoint.paid_undone"]);
    expect((await paid(client, job, "i14_0")).json<State>().status).toBe("completed");
  });

  it("is idempotent: pressing twice keeps the first time and who, undoing twice changes nothing more", async () => {
    const job = await fresh();
    const first = (await paid(client, job, "i7_5")).json<State>();
    t.clock.advance(60_000);
    const second = (await paid(staff, job, "i7_5")).json<State>();
    t.clock.advance(-60_000);
    expect(second.paid).toEqual(first.paid);
    expect(second.version).toBe(2);
    expect(await audits(job.id)).toHaveLength(1);
    await paid(client, job, "i7_5", "DELETE");
    const again = await paid(client, job, "i7_5", "DELETE");
    expect(again.statusCode).toBe(200);
    expect(again.json<State>()).toMatchObject({ paid: null, status: "not_completed", version: 3 });
    expect(await audits(job.id)).toHaveLength(2);
  });

  it("leaves a status that was set by hand alone when undoing a checkpoint that was never paid", async () => {
    const job = await fresh();
    await t.db
      .updateTable("checkpoint_states")
      .set({ status: "completed" })
      .where("job_id", "=", job.id)
      .where("checkpoint_key", "=", "i6_2")
      .execute();
    const res = await paid(staff, job, "i6_2", "DELETE");
    expect(res.json<State>()).toMatchObject({ status: "completed", paid: null, version: 1 });
    expect(await audits(job.id)).toEqual([]);
  });

  it("refuses an architect (403), a caller who cannot see the job (404), anonymous (401), and writes nothing", async () => {
    const job = await fresh();
    for (const method of ["PUT", "DELETE"] as const) {
      expect((await paid(architect, job, "i6_2", method)).statusCode).toBe(403);
      expect((await paid(outsider, job, "i6_2", method)).statusCode).toBe(404);
      expect((await paid(undefined, job, "i6_2", method)).statusCode).toBe(401);
      const noCsrf = await apiRequest(t, {
        method,
        url: `/v1/jobs/${job.id}/checkpoints/i6_2/paid`,
        as: client,
        csrf: null,
      });
      expect(noCsrf.statusCode).toBe(403);
    }
    expect(await state(job.id, "i6_2")).toMatchObject({ status: "not_completed", paid_at: null, version: 1 });
    expect(await audits(job.id)).toEqual([]);
    await t.db.updateTable("jobs").set({ deleted_at: new Date() }).where("id", "=", job.id).execute();
    expect((await paid(client, job, "i6_2")).statusCode).toBe(404);
  });

  it("answers 409 for a checkpoint without a client response button, and 400 for an unknown key", async () => {
    const job = await fresh();
    for (const key of ["i2_0", "i3_0p", "i1_0p"]) {
      const res = await paid(staff, job, key);
      expect(res.statusCode, key).toBe(key === "i1_0p" ? 403 : 409);
    }
    expect((await paid(staff, job, "i99_9")).statusCode).toBe(400);
    expect((await state(job.id, "i2_0")).status).toBe("not_completed");
  });
});
