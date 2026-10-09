import { randomBytes } from "node:crypto";
import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { createMetrics } from "@kr/telemetry";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { FAKE_VIRUS, startFakeClamd } from "../test/fake-clamd.js";
import { enqueue, insertJob, openDb, until } from "../test/db.js";
import { captureLog } from "../test/log.js";
import { insertFile } from "../test/files.js";
import { makePdf } from "../test/pdf.js";
import { startWorker } from "./app.js";
import { createClamdClient } from "./clients/clamd.js";
import { systemClock } from "./clock.js";
import { loadWorkerConfig } from "./config.js";
import { buildHandlers } from "./handlers/index.js";
import { createParser } from "./parsing/isolate.js";

let db: Db;
beforeAll(() => {
  db = openDb();
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom("operations").execute();
});

it("scans an uploaded email, queues its parse, and reads a Decision Letter, all through the poller", async () => {
  const clamd = await startFakeClamd();
  const storage = createMemoryStorage();
  const config = loadWorkerConfig({
    APP_ENV: "local",
    DATABASE_URL: "postgres://unused@localhost/unused",
    S3_ENDPOINT: "http://localhost:9",
    S3_BUCKET: "unused-bucket",
    S3_ACCESS_KEY_ID: "unused",
    S3_SECRET_ACCESS_KEY: randomBytes(12).toString("hex"),
    WORKER_POLL_INTERVAL_MS: "100",
    PORT: "8081",
  });
  const metrics = createMetrics({
    operationTypes: ["file.scan", "email.parse", "conditions.extract", "conformance.read"],
    operationStatuses: ["succeeded", "failed"] as const,
  });
  const worker = await startWorker({
    config: { ...config, HOST: "127.0.0.1", PORT: 0 },
    db,
    storage,
    log: captureLog().log,
    metrics,
    clock: systemClock,
    workerId: "pipeline-worker",
    handlers: buildHandlers({
      db,
      storage,
      clamd: createClamdClient({ host: "127.0.0.1", port: clamd.port, timeoutMs: 1000, maxBytes: 1024 * 1024 }),
      parser: createParser(),
      clock: systemClock,
      config,
      metrics,
    }),
  });
  try {
    const jobId = await insertJob(db);
    const eml = await insertFile(db, storage, jobId, {
      kind: "email",
      checkpointKey: "i4_3",
      slot: "email",
      bytes: "Subject: Lot 3 query\r\nFrom: p@example.test\r\n\r\nPlease advise.\r\n",
    });
    await db.insertInto("email_messages").values({ file_id: eml.id }).execute();
    const bad = await insertFile(db, storage, jobId, {
      bytes: FAKE_VIRUS,
      checkpointKey: "i4_3",
      slot: "email",
      kind: "email",
    });
    const letter = await insertFile(db, storage, jobId, {
      bytes: await makePdf([["Conditions", "1. Power supply. (Western Power)"]]),
      scanStatus: "clean",
    });
    await enqueue(db, jobId, "file.scan", { fileId: eml.id });
    await enqueue(db, jobId, "file.scan", { fileId: bad.id });
    await enqueue(db, jobId, "conditions.extract", { fileId: letter.id, replaceExisting: false });

    const email = await until(
      () =>
        db
          .selectFrom("email_messages")
          .select(["parse_status", "subject"])
          .where("file_id", "=", eml.id)
          .executeTakeFirstOrThrow(),
      (e) => e.parse_status === "parsed",
    );
    expect(email.subject).toBe("Lot 3 query");
    const conditions = await until(
      () => db.selectFrom("conditions").select("agency").where("job_id", "=", jobId).execute(),
      (rows) => rows.length > 0,
    );
    expect(conditions).toEqual([{ agency: "Western Power" }]);
    const scans = await until(
      () => db.selectFrom("files").select(["id", "scan_status"]).where("job_id", "=", jobId).execute(),
      (rows) => rows.every((r) => r.scan_status !== "pending"),
    );
    expect(Object.fromEntries(scans.map((r) => [r.id, r.scan_status]))).toEqual({
      [eml.id]: "clean",
      [bad.id]: "infected",
      [letter.id]: "clean",
    });
    expect(await storage.exists(bad.key)).toBe(false);
    const operations = await db
      .selectFrom("operations")
      .select(["type", "status"])
      .where("job_id", "=", jobId)
      .execute();
    expect(operations.every((o) => o.status === "succeeded")).toBe(true);
    expect(operations.map((o) => o.type).sort()).toEqual([
      "conditions.extract",
      "email.parse",
      "file.scan",
      "file.scan",
    ]);
  } finally {
    await worker.drain(2000);
    await worker.close();
    await clamd.stop();
  }
});
