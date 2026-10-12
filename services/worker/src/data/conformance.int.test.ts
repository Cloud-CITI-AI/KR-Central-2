import type { Db } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertJob, openDb } from "../../test/db.js";
import { TaskError } from "../errors.js";
import { applyConformedDate } from "./conformance.js";

let db: Db;
beforeAll(() => {
  db = openDb();
});
afterAll(async () => {
  await db.destroy();
});

describe("applyConformedDate range guard (QA r2: never commit a date the job page cannot serve)", () => {
  it.each(["2200-01-01", "1066-05-12", "2199-12-31", "2026-02-30"])(
    "refuses %s before the UPDATE and leaves the job unchanged",
    async (date) => {
      const jobId = await insertJob(db);
      const before = await db.selectFrom("jobs").selectAll().where("id", "=", jobId).executeTakeFirstOrThrow();
      const fileId = "00000000-0000-4000-8000-000000000001";
      const run = db
        .transaction()
        .execute((trx) => applyConformedDate(trx, { jobId, fileId, found: { date, method: "text", stampText: null } }));
      await expect(run).rejects.toBeInstanceOf(TaskError);
      const after = await db.selectFrom("jobs").selectAll().where("id", "=", jobId).executeTakeFirstOrThrow();
      expect(after).toEqual(before);
    },
  );
});
