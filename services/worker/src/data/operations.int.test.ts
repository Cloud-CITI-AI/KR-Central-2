import type { Db } from "@kr/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { readQueue } from "./operations.js";

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

describe("readQueue", () => {
  it("counts due queued operations per type and reports how long the oldest has waited", async () => {
    const old = await enqueue(db, jobId, "file.scan");
    await enqueue(db, jobId, "file.scan");
    await enqueue(db, jobId, "email.parse");
    await db
      .updateTable("operations")
      .set({ run_after: new Date(Date.now() - 90_000) })
      .where("id", "=", old.id)
      .execute();
    const { depth, age } = await readQueue(db);
    expect(depth).toEqual({ "file.scan": 2, "email.parse": 1 });
    expect(age["file.scan"]).toBeGreaterThanOrEqual(90);
    expect(age["email.parse"]).toBeLessThan(30);
  });

  it("ignores operations that are running or not due yet (a retry waiting out its back-off)", async () => {
    const running = await enqueue(db, jobId, "file.scan");
    const later = await enqueue(db, jobId, "email.parse");
    await db.updateTable("operations").set({ status: "running" }).where("id", "=", running.id).execute();
    await db
      .updateTable("operations")
      .set({ run_after: new Date(Date.now() + 60_000) })
      .where("id", "=", later.id)
      .execute();
    expect(await readQueue(db)).toEqual({ depth: {}, age: {} });
  });
});
