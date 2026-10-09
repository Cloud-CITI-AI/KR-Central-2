import type { Db, OperationTypeValue } from "@kr/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, insertJob, openDb, operation, until } from "../test/db.js";
import { captureLog } from "../test/log.js";
import { TaskError } from "./errors.js";
import type { Handler, Handlers } from "./handlers/types.js";
import { Poller } from "./poller.js";

let db: Db;
let jobId: string;
beforeAll(async () => {
  db = openDb();
  jobId = await insertJob(db);
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom("operations").execute();
});

const metrics = () => ({ recordOperation: vi.fn() });

function makePoller(
  handlers: Handlers,
  extra: { workerId?: string; leaseSeconds?: number; concurrency?: number } = {},
) {
  const captured = captureLog();
  const m = metrics();
  const poller = new Poller({
    db,
    workerId: extra.workerId ?? "worker-a",
    handlers,
    log: captured.log,
    metrics: m,
    concurrency: extra.concurrency ?? 2,
    pollIntervalMs: 20,
    leaseSeconds: extra.leaseSeconds ?? 60,
    requeueIntervalMs: 50,
  });
  return { poller, metrics: m, events: captured.events };
}

const handler = (run: Handler["run"], timeoutMs = 5000): Handler => ({ timeoutMs, run });

describe("the poller", () => {
  it("runs the handler of the operation's type and stores the result", async () => {
    const op = await enqueue(db, jobId, "file.scan", { fileId: "f1" });
    const { poller, metrics: m } = makePoller({
      "file.scan": handler((ctx) => Promise.resolve({ seen: ctx.operation.payload })),
    });
    poller.start();
    const done = await until(
      () => operation(db, op.id),
      (o) => o.status === "succeeded",
    );
    expect(await poller.stop(1000)).toBe(true);
    expect(done.result).toEqual({ seen: { fileId: "f1" } });
    expect(done.attempts).toBe(1);
    expect(m.recordOperation).toHaveBeenCalledWith(expect.objectContaining({ type: "file.scan", status: "succeeded" }));
  });

  it("claims only the types it has a handler for", async () => {
    const other = await enqueue(db, jobId, "email.parse");
    const mine = await enqueue(db, jobId, "file.scan");
    const { poller } = makePoller({ "file.scan": handler(() => Promise.resolve(null)) });
    poller.start();
    await until(
      () => operation(db, mine.id),
      (o) => o.status === "succeeded",
    );
    await poller.stop(1000);
    expect((await operation(db, other.id)).status).toBe("queued");
  });

  it("never runs an operation twice with two workers polling the same queue", async () => {
    const ops = await Promise.all(Array.from({ length: 40 }, () => enqueue(db, jobId, "file.scan")));
    const runs = new Map<string, string[]>();
    const run = (worker: string): Handler =>
      handler(async (ctx) => {
        runs.set(ctx.operation.id, [...(runs.get(ctx.operation.id) ?? []), worker]);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return worker;
      });
    const a = makePoller({ "file.scan": run("a") }, { workerId: "worker-a", concurrency: 4 });
    const b = makePoller({ "file.scan": run("b") }, { workerId: "worker-b", concurrency: 4 });
    a.poller.start();
    b.poller.start();
    await until(
      () => db.selectFrom("operations").select("status").execute(),
      (rows) => rows.every((r) => r.status === "succeeded"),
    );
    await Promise.all([a.poller.stop(1000), b.poller.stop(1000)]);
    expect(runs.size).toBe(40);
    for (const op of ops) expect(runs.get(op.id)).toHaveLength(1);
    const winners = new Set([...runs.values()].flat());
    expect(winners).toEqual(new Set(["a", "b"]));
  });

  it("re-queues an operation whose worker died and runs it once", async () => {
    const op = await enqueue(db, jobId, "file.scan");
    await db
      .updateTable("operations")
      .set({ status: "running", locked_by: "dead-worker", locked_until: new Date(Date.now() - 1000), attempts: 1 })
      .where("id", "=", op.id)
      .execute();
    const run = vi.fn(() => Promise.resolve("ok"));
    const { poller, events } = makePoller({ "file.scan": handler(run) });
    poller.start();
    const done = await until(
      () => operation(db, op.id),
      (o) => o.status === "succeeded",
    );
    await poller.stop(1000);
    expect(done.attempts).toBe(2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(events()).toContain("leases_requeued");
  });

  it("fails the operation for good when the dead worker used up its attempts", async () => {
    const op = await enqueue(db, jobId, "file.scan", {}, 1);
    await db
      .updateTable("operations")
      .set({ status: "running", locked_by: "dead-worker", locked_until: new Date(Date.now() - 1000), attempts: 1 })
      .where("id", "=", op.id)
      .execute();
    const { poller } = makePoller({ "file.scan": handler(() => Promise.resolve(null)) });
    poller.start();
    const done = await until(
      () => operation(db, op.id),
      (o) => o.status === "failed",
    );
    await poller.stop(1000);
    expect(done.error_code).toBe("lease_expired");
  });

  it("keeps a long-running operation's lease alive so nobody else takes it", async () => {
    const op = await enqueue(db, jobId, "file.scan");
    const run = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2200));
      return "slow";
    });
    const a = makePoller({ "file.scan": handler(run, 10_000) }, { workerId: "worker-a", leaseSeconds: 1 });
    const b = makePoller({ "file.scan": handler(run, 10_000) }, { workerId: "worker-b", leaseSeconds: 1 });
    a.poller.start();
    b.poller.start();
    const done = await until(
      () => operation(db, op.id),
      (o) => o.status === "succeeded",
    );
    await Promise.all([a.poller.stop(1000), b.poller.stop(1000)]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(done.attempts).toBe(1);
  });
});

describe("failures", () => {
  async function failWith(error: Error, maxAttempts = 3) {
    const op = await enqueue(db, jobId, "file.scan", {}, maxAttempts);
    const { poller, metrics: m, events } = makePoller({ "file.scan": handler(() => Promise.reject(error)) });
    poller.start();
    const row = await until(
      () => operation(db, op.id),
      (o) => o.status !== "queued" && o.status !== "running",
    );
    await poller.stop(1000);
    return { row, m, events };
  }

  it("fails a permanent TaskError at once with its code and user-safe message", async () => {
    const { row, m } = await failWith(new TaskError("not_a_pdf", "That file is not a PDF, so it could not be read."));
    expect(row.status).toBe("failed");
    expect(row.error_code).toBe("not_a_pdf");
    expect(row.error_message).toBe("That file is not a PDF, so it could not be read.");
    expect(m.recordOperation).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("re-queues a retryable failure with back-off and counts it only when it finally fails", async () => {
    const { row, m } = await failWith(new TaskError("storage_unavailable", "Try again.", { retryable: true }));
    expect(row.status).toBe("queued");
    expect(row.error_code).toBe("storage_unavailable");
    expect(row.run_after.getTime()).toBeGreaterThan(Date.now() + 5000);
    expect(m.recordOperation).not.toHaveBeenCalled();
  });

  it("fails after max_attempts even when the error is retryable", async () => {
    const { row } = await failWith(new TaskError("storage_unavailable", "Try again.", { retryable: true }), 1);
    expect(row.status).toBe("failed");
  });

  it("treats an unexpected throw as a retryable internal error and stores none of its text", async () => {
    const { row, events } = await failWith(new Error("select * from users where email = 'a@b.test' failed"));
    expect(row.status).toBe("queued");
    expect(row.run_after.getTime()).toBeGreaterThan(Date.now() + 5000);
    expect(row.error_code).toBe("internal_error");
    expect(row.error_message).not.toContain("a@b.test");
    expect(events()).toContain("operation_requeued");
  });

  it("times a stuck handler out, aborts its signal and records the timeout", async () => {
    const op = await enqueue(db, jobId, "file.scan", {}, 1);
    let aborted = false;
    const { poller } = makePoller({
      "file.scan": handler(
        (ctx) =>
          new Promise<never>((_resolve, reject) => {
            ctx.signal.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          }),
        100,
      ),
    });
    poller.start();
    const row = await until(
      () => operation(db, op.id),
      (o) => o.status === "failed",
    );
    await poller.stop(1000);
    expect(row.error_code).toBe("timeout");
    expect(aborted).toBe(true);
  });

  it("fails an operation of a type it was handed without a handler (defensive)", async () => {
    const op = await enqueue(db, jobId, "email.parse", {}, 1);
    const handlers = { "email.parse": handler(() => Promise.resolve(null)) };
    const { poller } = makePoller(handlers);
    delete (handlers as Partial<Record<OperationTypeValue, Handler>>)["email.parse"];
    poller.start();
    const row = await until(
      () => operation(db, op.id),
      (o) => o.status === "failed",
    );
    await poller.stop(1000);
    expect(row.error_code).toBe("unsupported_operation");
  });
});

describe("stopping", () => {
  it("stops claiming, lets in-flight work finish and reports a clean drain", async () => {
    const first = await enqueue(db, jobId, "file.scan");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => {
      await gate;
      return "done";
    });
    const { poller } = makePoller({ "file.scan": handler(run) }, { concurrency: 1 });
    poller.start();
    await until(
      () => operation(db, first.id),
      (o) => o.status === "running",
    );
    const stopping = poller.stop(5000);
    expect(poller.draining).toBe(true);
    const later = await enqueue(db, jobId, "file.scan");
    release();
    expect(await stopping).toBe(true);
    expect((await operation(db, first.id)).status).toBe("succeeded");
    expect((await operation(db, later.id)).status).toBe("queued");
  });

  it("releases the lease of work that did not finish in time so another worker takes it", async () => {
    const op = await enqueue(db, jobId, "file.scan");
    const { poller } = makePoller(
      { "file.scan": handler(() => new Promise<never>(() => undefined), 60_000) },
      { concurrency: 1 },
    );
    poller.start();
    await until(
      () => operation(db, op.id),
      (o) => o.status === "running",
    );
    expect(await poller.stop(100)).toBe(false);
    const row = await operation(db, op.id);
    expect(row.status).toBe("running");
    expect(row.locked_until?.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
