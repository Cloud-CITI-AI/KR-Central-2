import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../test/factories.js";
import { createTestApp, signIn, type SignedIn, type TestApp } from "../../test/helpers/index.js";
import { audit, auditContext, diffChanges, withTransaction } from "./audit.js";
import type { ApiModule } from "./module.js";

const mod: ApiModule = {
  name: "audit-test",
  operations: [],
  register(app, deps) {
    app.post("/test/audited", async (request, reply) => {
      const ctx = auditContext(request);
      const jobId = (request.body as { jobId: string }).jobId;
      await withTransaction(deps.db, async (trx) => {
        await trx.updateTable("jobs").set({ address: "2 Changed Rd" }).where("id", "=", jobId).execute();
        await audit(trx, ctx, {
          action: "job.updated",
          entityType: "job",
          entityId: jobId,
          jobId,
          changes: diffChanges({ address: "old", token: "same" }, { address: "2 Changed Rd", token: "same" }),
        });
        if ((request.body as { fail?: boolean }).fail) throw new Error("rollback please");
      });
      return reply.send({ ok: true });
    });
  },
};

describe("audit and transactions (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let me: SignedIn;
  beforeAll(async () => {
    t = await createTestApp({ extraModules: [mod] });
    f = createFactories(t.db);
    me = await signIn(t, await f.makeUser({ role: "staff" }));
  });
  afterAll(async () => {
    await t.close();
  });
  const events = (jobId: string) => t.db.selectFrom("audit_events").selectAll().where("job_id", "=", jobId).execute();
  const post = (jobId: string, fail = false) =>
    t.app.inject({
      method: "POST",
      url: "/test/audited",
      headers: {
        cookie: me.cookie,
        "x-csrf-token": me.csrf,
        origin: "https://tracker.test",
        "x-request-id": "req-audit-0001",
      },
      payload: { jobId, fail },
    });

  it("commits the change and its audit row together, with actor, request id and only the changed fields", async () => {
    const job = await f.makeJob();
    expect((await post(job.id)).statusCode).toBe(200);
    const [event, ...rest] = await events(job.id);
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      actor_user_id: me.user.id,
      actor_type: "user",
      action: "job.updated",
      entity_type: "job",
      entity_id: job.id,
      request_id: "req-audit-0001",
      changes: { address: { from: "old", to: "2 Changed Rd" } },
    });
    expect(event?.changes).not.toHaveProperty("token");
    expect(
      (await t.db.selectFrom("jobs").select("address").where("id", "=", job.id).executeTakeFirstOrThrow()).address,
    ).toBe("2 Changed Rd");
  });

  it("rolls back the change and the audit row together when the work fails", async () => {
    const job = await f.makeJob();
    expect((await post(job.id, true)).statusCode).toBe(500);
    expect(await events(job.id)).toEqual([]);
    expect(
      (await t.db.selectFrom("jobs").select("address").where("id", "=", job.id).executeTakeFirstOrThrow()).address,
    ).toBe(job.address);
  });

  it("records system actions without an actor", async () => {
    const job = await f.makeJob();
    await withTransaction(t.db, (trx) =>
      audit(
        trx,
        { actorUserId: null, requestId: "sweep-1" },
        { action: "job.swept", entityType: "job", jobId: job.id },
      ),
    );
    expect(await events(job.id)).toMatchObject([{ actor_type: "system", actor_user_id: null, request_id: "sweep-1" }]);
  });
});
