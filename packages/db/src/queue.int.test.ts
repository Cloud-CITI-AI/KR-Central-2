import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { recordAudit } from "./audit.js";
import { createDb, type Db } from "./pool.js";
import {
  claimNextOperation,
  completeOperation,
  enqueueOperation,
  failOperation,
  requeueExpiredLeases,
} from "./queue.js";

describe("operations queue (integration)", () => {
  let db: Db;
  let jobId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: inject("databaseUrl") });
    jobId = (
      await db
        .insertInto("jobs")
        .values({ job_number: `Q-${Date.now()}`, address: "1 Queue St" })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;
  });
  afterAll(async () => db.destroy());

  it("claims each operation once, even with concurrent workers", async () => {
    const op = await enqueueOperation(db, { jobId, type: "email.parse", payload: { fileId: "x" }, createdBy: null });
    const [a, b] = await Promise.all([
      claimNextOperation(db, "w1", 60, ["email.parse"]),
      claimNextOperation(db, "w2", 60, ["email.parse"]),
    ]);
    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(op.id);
    expect(claimed[0]?.attempts).toBe(1);
    expect(await completeOperation(db, op.id, claimed[0]!.locked_by!, { ok: true })).toBe(true);
    expect(await completeOperation(db, op.id, "someone-else", {})).toBe(false);
  });

  it("re-queues retryable failures and fails permanently after max attempts", async () => {
    const op = await enqueueOperation(db, { jobId, type: "file.scan", payload: {}, createdBy: null, maxAttempts: 1 });
    const c = await claimNextOperation(db, "w1", 60, ["file.scan"]);
    expect(c?.id).toBe(op.id);
    expect(await failOperation(db, op.id, "w1", { code: "clamd_unreachable", message: "x", retryable: true })).toBe(
      "failed",
    );
    const row = await db.selectFrom("operations").selectAll().where("id", "=", op.id).executeTakeFirstOrThrow();
    expect(row.status).toBe("failed");
  });

  it("re-queues expired leases", async () => {
    const op = await enqueueOperation(db, { jobId, type: "conformance.read", payload: {}, createdBy: null });
    await claimNextOperation(db, "w1", 60, ["conformance.read"]);
    await db
      .updateTable("operations")
      .set({ locked_until: new Date(Date.now() - 1000) })
      .where("id", "=", op.id)
      .execute();
    expect(await requeueExpiredLeases(db)).toBeGreaterThanOrEqual(1);
    expect(
      (await db.selectFrom("operations").select("status").where("id", "=", op.id).executeTakeFirstOrThrow()).status,
    ).toBe("queued");
  });

  it("writes audit events and rejects malformed actions", async () => {
    await recordAudit(db, {
      actorUserId: null,
      action: "job.created",
      entityType: "job",
      entityId: jobId,
      jobId,
      changes: { address: { from: null, to: "x" } },
    });
    await expect(recordAudit(db, { actorUserId: null, action: "Bad Action", entityType: "job" })).rejects.toThrow(
      RangeError,
    );
  });
});
