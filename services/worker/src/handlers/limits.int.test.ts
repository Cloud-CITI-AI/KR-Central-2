import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { createMetrics } from "@kr/telemetry";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { enqueue, insertJob, openDb, operation, until } from "../../test/db.js";
import { insertFile } from "../../test/files.js";
import { captureLog } from "../../test/log.js";
import { Poller } from "../poller.js";
import { DEFAULT_PARSE_LIMITS, runInThread, type Parser } from "../parsing/isolate.js";
import { emailParseHandler } from "./email-parse.js";

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

const misbehaving = new URL("../../test/fixtures/misbehaving-thread.ts", import.meta.url);

/** A parser whose thread misbehaves (the real isolation, with the limits shortened) so the operation hits a real limit. */
const hostile = (mode: "loop" | "alloc"): Parser => ({
  run: (_task, _input, signal) =>
    runInThread(
      { mode },
      { ...DEFAULT_PARSE_LIMITS, timeoutMs: mode === "loop" ? 1000 : 30_000, maxOldGenerationSizeMb: 32 },
      signal,
      misbehaving,
    ) as never,
});

it.each([
  ["loop", "timeout"],
  ["alloc", "too_complex"],
] as const)(
  "a parse that hits its %s limit fails the operation cleanly, marks the email failed and leaves the worker running",
  async (mode, code) => {
    const jobId = await insertJob(db);
    const storage = createMemoryStorage();
    const file = await insertFile(db, storage, jobId, {
      kind: "email",
      checkpointKey: "i4_3",
      slot: "email",
      scanStatus: "clean",
    });
    await db.insertInto("email_messages").values({ file_id: file.id }).execute();
    const op = await enqueue(db, jobId, "email.parse", { fileId: file.id }, 1);
    const { log } = captureLog();
    const poller = new Poller({
      db,
      workerId: "limits-worker",
      handlers: {
        "email.parse": emailParseHandler({
          db,
          storage,
          parser: hostile(mode),
          config: { UPLOAD_MAX_BYTES: 1024 * 1024 },
        }),
      },
      log,
      metrics: createMetrics({ operationTypes: ["email.parse"], operationStatuses: ["succeeded", "failed"] as const }),
      concurrency: 1,
      pollIntervalMs: 20,
      leaseSeconds: 60,
    });
    poller.start();
    const done = await until(
      () => operation(db, op.id),
      (o) => o.status === "failed",
    );
    expect(await poller.stop(1000)).toBe(true);
    expect(done).toMatchObject({ status: "failed", error_code: code });
    expect(done.error_message).toMatch(/too long|too large or complex/);
    const email = await db
      .selectFrom("email_messages")
      .select("parse_status")
      .where("file_id", "=", file.id)
      .executeTakeFirstOrThrow();
    expect(email.parse_status).toBe("failed");
  },
);
