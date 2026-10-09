import type { CheckpointState, JobDetail } from "@kr/contracts";
import type { JobRow } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

type State = z.output<typeof CheckpointState>;
type Detail = z.output<typeof JobDetail>;

describe("recordDecision (real Postgres)", () => {
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
  const decide = (who: SignedIn | undefined, job: Pick<JobRow, "id">, key: string, body: unknown) =>
    apiRequest(t, {
      method: "PUT",
      url: `/v1/jobs/${job.id}/checkpoints/${key}/decision`,
      ...(who ? { as: who } : {}),
      body,
    });
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
      .where("action", "=", "checkpoint.decision_recorded")
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

  it("records the client's decision with who and when, and leaves the status unchanged (§5.5)", async () => {
    const job = await fresh();
    const res = await decide(client, job, "i3_0p", { value: "accepted" });
    expect(res.statusCode).toBe(200);
    expect(res.json<State>()).toMatchObject({
      key: "i3_0p",
      decision: { value: "accepted", comment: "", at: t.deps.clock.now().toISOString(), by: { id: client.user.id } },
      status: "not_completed",
      storedStatus: "not_completed",
      version: 2,
    });
    expect(await state(job.id, "i3_0p")).toMatchObject({
      decision: "accepted",
      decided_by: client.user.id,
      status: "not_completed",
      version: 2,
    });
    const done = await decide(client, job, "i3_0p", { value: "declined", comment: "Not what we agreed" });
    expect(done.json<State>()).toMatchObject({
      decision: { value: "declined", comment: "Not what we agreed" },
      status: "not_completed",
    });
    await t.db
      .updateTable("checkpoint_states")
      .set({ status: "completed" })
      .where("job_id", "=", job.id)
      .where("checkpoint_key", "=", "i3_0p")
      .execute();
    expect((await decide(client, job, "i3_0p", { value: "accepted" })).json<State>().status).toBe("completed");
  });

  it("lets staff, kr_admin and admin record it on the client's behalf, and audits it in the same transaction", async () => {
    for (const who of [staff, krAdmin, admin]) {
      const job = await fresh();
      const res = await decide(who, job, "i6_1a", { value: "declined", comment: "Client rang to decline" });
      expect(res.statusCode).toBe(200);
      expect(res.json<State>().decision).toMatchObject({ value: "declined", by: { id: who.user.id } });
      const [event, ...rest] = await audits(job.id);
      expect(rest).toEqual([]);
      expect(event).toMatchObject({
        actor_user_id: who.user.id,
        entity_type: "checkpoint",
        entity_id: "i6_1a",
        request_id: res.headers["x-request-id"],
        changes: { decision: { from: null, to: "declined" }, commentLength: { from: 0, to: 22 } },
      });
      expect(JSON.stringify(event?.changes)).not.toContain("rang");
      expect(
        (await t.db.selectFrom("jobs").select("version").where("id", "=", job.id).executeTakeFirstOrThrow()).version,
      ).toBe(2);
    }
  });

  it("refuses an architect (403), a caller who cannot see the job (404), anonymous (401), and writes nothing", async () => {
    const job = await fresh();
    expect((await decide(architect, job, "i3_0p", { value: "accepted" })).statusCode).toBe(403);
    expect((await decide(outsider, job, "i3_0p", { value: "accepted" })).statusCode).toBe(404);
    expect((await decide(undefined, job, "i3_0p", { value: "accepted" })).statusCode).toBe(401);
    const noCsrf = await apiRequest(t, {
      method: "PUT",
      url: `/v1/jobs/${job.id}/checkpoints/i3_0p/decision`,
      as: client,
      csrf: null,
      body: { value: "accepted" },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect((await state(job.id, "i3_0p")).decision).toBeNull();
    expect(await audits(job.id)).toEqual([]);
    await t.db.updateTable("jobs").set({ deleted_at: new Date() }).where("id", "=", job.id).execute();
    expect((await decide(client, job, "i3_0p", { value: "accepted" })).statusCode).toBe(404);
  });

  it("needs a non-blank comment to decline (R14) in the API and in the database", async () => {
    const job = await fresh();
    for (const comment of [undefined, "", "   \n"]) {
      const res = await decide(client, job, "i3_0p", { value: "declined", comment });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ errors: [{ path: "comment" }] });
    }
    expect((await state(job.id, "i3_0p")).decision).toBeNull();
    await expect(
      t.db
        .updateTable("checkpoint_states")
        .set({ decision: "declined", decision_comment: " ", decided_at: new Date() })
        .where("job_id", "=", job.id)
        .where("checkpoint_key", "=", "i3_0p")
        .execute(),
    ).rejects.toMatchObject({ constraint: "checkpoint_states_decline_needs_comment" });
  });

  it("rejects unknown values, unknown fields and an over-long comment with 400", async () => {
    const job = await fresh();
    for (const body of [
      {},
      { value: "maybe" },
      { value: "accepted", extra: 1 },
      { value: "accepted", comment: "x".repeat(2001) },
    ]) {
      expect((await decide(client, job, "i3_0p", body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await decide(client, job, "i99_9", { value: "accepted" })).statusCode).toBe(400);
  });

  it("answers 409 for a checkpoint without an approval panel", async () => {
    const job = await fresh();
    for (const key of ["i2_0", "i14_0"]) {
      const res = await decide(staff, job, key, { value: "accepted" });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        type: "urn:kr:problem:conflict",
        detail: "This checkpoint has no approval panel.",
      });
    }
  });

  it("is idempotent: the same decision again keeps the first record and writes no second audit row", async () => {
    const job = await fresh();
    await decide(client, job, "i6_1a", { value: "accepted" });
    const again = await decide(staff, job, "i6_1a", { value: "accepted" });
    expect(again.json<State>()).toMatchObject({ version: 2, decision: { by: { id: client.user.id } } });
    expect(await audits(job.id)).toHaveLength(1);
  });

  it("keeps the fee proposal for fee_proposal.view holders: the client and kr_admin decide, staff may not", async () => {
    const job = await fresh();
    expect((await decide(staff, job, "i1_0p", { value: "accepted" })).statusCode).toBe(403);
    expect((await state(job.id, "i1_0p")).decision).toBeNull();
    const declined = await decide(client, job, "i1_0p", { value: "declined", comment: "Too expensive" });
    expect(declined.statusCode).toBe(200);
    expect(declined.json<State>()).toMatchObject({ isRestricted: false, decision: { value: "declined" } });
    expect((await decide(krAdmin, job, "i1_0p", { value: "accepted" })).statusCode).toBe(200);
    await decide(client, job, "i1_0p", { value: "declined", comment: "Still too expensive" });

    const alertsFor = async (who: SignedIn) =>
      (await apiRequest(t, { url: `/v1/jobs/${job.id}`, as: who })).json<Detail>().summary.alerts.map((a) => a.text);
    expect(await alertsFor(krAdmin)).toEqual(["Client declined the fee proposal (1.0)"]);
    expect(await alertsFor(staff)).toEqual([]);
    expect(await alertsFor(architect)).toEqual([]);
  });
});
