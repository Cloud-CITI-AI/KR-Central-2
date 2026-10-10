import { ConformanceReadResult } from "@kr/contracts";
import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { startFakeAnthropic } from "../../test/fake-anthropic.js";
import { handlerContext, insertFile } from "../../test/files.js";
import { makePdf } from "../../test/pdf.js";
import { createAnthropicStampReader } from "../clients/anthropic-stamp-reader.js";
import { StampReaderError, type StampReader, type StampReading } from "../clients/stamp-reader.js";
import { TaskError } from "../errors.js";
import { staticFlags } from "../flags.js";
import { createParser, type Parser } from "../parsing/isolate.js";
import { conformanceReadHandler } from "./conformance-read.js";

let db: Db;
let jobId: string;
const storage = createMemoryStorage();
beforeAll(() => {
  db = openDb();
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom("operations").execute();
  jobId = await insertJob(db);
});

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const CONFORMED_LINE = ["Conformance Notification", "The plan was conformed on 16 March 2026."];
const notCalled = <T>(): { run: () => Promise<T>; read: () => Promise<StampReading> } => ({
  run: () => Promise.reject(new Error("must not be called")),
  read: () => Promise.reject(new Error("must not be called")),
});

interface Options {
  readonly name?: string;
  readonly pages?: string[][];
  readonly annotation?: string;
  readonly allowAi?: boolean;
  readonly flag?: boolean;
  readonly key?: string | undefined;
  readonly reader?: StampReader | undefined;
  readonly parser?: Parser;
  readonly scanStatus?: "clean" | "pending";
}

async function read(o: Options = {}) {
  const file = await insertFile(db, storage, jobId, {
    bytes: await makePdf(o.pages ?? [CONFORMED_LINE], o.annotation),
    name: o.name ?? "Conformance Notification.pdf",
    checkpointKey: "i4_2",
    slot: "conformance",
    scanStatus: o.scanStatus ?? "clean",
  });
  const metrics = { recordStampReading: vi.fn() };
  const handler = conformanceReadHandler({
    db,
    storage,
    parser: o.parser ?? createParser(),
    flags: staticFlags({ "ai-stamp-reading": o.flag ?? true }),
    stampReader: o.reader,
    metrics,
    config: {
      UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
      ANTHROPIC_API_KEY: "key" in o ? o.key : "test-key",
    },
  });
  const op = await enqueue(db, jobId, "conformance.read", { fileId: file.id, allowAi: o.allowAi ?? true });
  const outcome = await handler.run(handlerContext(op)).then(
    (result) => ({ result: result as Record<string, unknown>, error: undefined }),
    (error: unknown) => ({ result: undefined, error: error as TaskError }),
  );
  return { file, metrics, ...checked(outcome) };
}

/** What is stored as operations.result must be the contract's ConformanceReadResult, with nothing extra. */
function checked<T extends { result: Record<string, unknown> | undefined }>(outcome: T): T {
  if (outcome.result !== undefined) expect(ConformanceReadResult.parse(outcome.result)).toEqual(outcome.result);
  return outcome;
}

const job = () => db.selectFrom("jobs").selectAll().where("id", "=", jobId).executeTakeFirstOrThrow();
const reading = (r: Partial<StampReading>): StampReading => ({
  found: true,
  date: "2026-03-10",
  stampText: "DATE 10-Mar-2026 FILE 123-26",
  ...r,
});
const readerOf = (outcome: StampReading | Error): StampReader & { calls: Uint8Array[] } => {
  const calls: Uint8Array[] = [];
  return {
    calls,
    read: (png) => {
      calls.push(png);
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
  };
};

describe("conformance.read: long documents", () => {
  it("reads page 1 of an 80-page PDF with no date in its name (the page cap is for Decision Letters)", async () => {
    const { result } = await read({
      name: "conformance big.pdf",
      pages: [CONFORMED_LINE, ...Array.from({ length: 79 }, (_, i) => [`Page ${i + 2}`])],
    });
    expect(result).toMatchObject({ found: true, date: "2026-03-16", method: "text" });
    expect(await job()).toMatchObject({ conformed_date: "2026-03-16", outcome_date: "2026-06-14" });
  });
});

describe("conformance.read: the order of the attempts", () => {
  it("takes the date from the file name without opening the PDF or calling the AI, and sets the outcome date to +90 days", async () => {
    const reader = { ...notCalled<never>() };
    const { file, result } = await read({
      name: "WAPC conformance 20260316.pdf",
      parser: notCalled<never>() as unknown as Parser,
      reader,
    });
    expect(result).toEqual({
      found: true,
      date: "2026-03-16",
      method: "file_name",
      stampText: null,
      message: "Taken from the file name: Mon, 16 Mar 2026.",
    });
    expect(await job()).toMatchObject({
      conformed_date: "2026-03-16",
      conformed_method: "file_name",
      conformed_file_id: file.id,
      conformed_stamp_text: null,
      outcome_date: "2026-06-14",
      version: 2,
    });
    const audit = await db.selectFrom("audit_events").selectAll().where("job_id", "=", jobId).execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_type: "system", actor_user_id: null, action: "conformance.date_read" });
    expect(audit[0]?.changes).toMatchObject({
      conformedDate: { from: null, to: "2026-03-16" },
      outcomeDate: { from: null, to: "2026-06-14" },
    });
  });

  it("overwrites a date entered by hand, its outcome date and its file", async () => {
    await db
      .updateTable("jobs")
      .set({
        conformed_date: "2026-01-01",
        conformed_method: "manual",
        outcome_date: "2026-05-05",
        conformed_stamp_text: "old",
      })
      .where("id", "=", jobId)
      .execute();
    await read({ name: "notice 16-03-2026.pdf" });
    expect(await job()).toMatchObject({
      conformed_date: "2026-03-16",
      conformed_method: "file_name",
      conformed_stamp_text: null,
      outcome_date: "2026-06-14",
    });
  });

  it("uses a stamp annotation before the AI and the text", async () => {
    const reader = readerOf(reading({}));
    const { result } = await read({ annotation: "DATE 17-Mar-2026 FILE 123-26", reader });
    expect(result).toMatchObject({
      date: "2026-03-17",
      method: "stamp_annotation",
      message: "Read from the stamp on page 1: Tue, 17 Mar 2026.",
    });
    expect(reader.calls).toHaveLength(0);
  });

  it("asks the AI before the text rule, though the text has a conformed date, and keeps the stamp text", async () => {
    const reader = readerOf(reading({}));
    const { result, metrics } = await read({ reader });
    expect(result).toEqual({
      found: true,
      date: "2026-03-10",
      method: "stamp_image",
      stampText: "DATE 10-Mar-2026 FILE 123-26",
      message:
        'Read from the stamp on page 1 ("DATE 10-Mar-2026 FILE 123-26"): Tue, 10 Mar 2026. Please check it below.',
    });
    expect(reader.calls).toHaveLength(1);
    expect([...new Uint8Array(reader.calls[0] ?? []).subarray(0, 4)]).toEqual(PNG_SIGNATURE);
    expect(await job()).toMatchObject({
      conformed_method: "stamp_image",
      conformed_stamp_text: "DATE 10-Mar-2026 FILE 123-26",
      outcome_date: "2026-06-08",
    });
    expect(metrics.recordStampReading).toHaveBeenCalledExactlyOnceWith("read");
  });

  it("falls back to the text rule when the AI is not allowed, and counts the AI step as disabled", async () => {
    const { result, metrics } = await read({ allowAi: false, reader: notCalled<never>() });
    expect(result).toMatchObject({
      date: "2026-03-16",
      method: "text",
      message:
        'No stamp could be read, so the "conformed" date in the text was used: Mon, 16 Mar 2026. Please check it below.',
    });
    expect(metrics.recordStampReading).toHaveBeenCalledExactlyOnceWith("disabled");
  });
});

describe("conformance.read: when the AI may be called", () => {
  it.each([
    ["the request does not allow it", { allowAi: false }],
    ["the flag is off", { flag: false }],
    ["there is no API key", { key: undefined }],
    ["the worker built no reader", { reader: undefined }],
  ] as const)("never calls the reader when %s", async (_name, variation) => {
    const reader = readerOf(reading({}));
    const options: Options = { reader, ...variation };
    const { result } = await read(options);
    expect(result).toMatchObject({ method: "text" });
    expect(reader.calls).toHaveLength(0);
  });

  it.each([
    ["refused", new StampReaderError("refused")],
    ["timeout", new StampReaderError("timeout")],
    ["unparseable", new StampReaderError("unparseable")],
    ["error", new StampReaderError("error")],
    ["error", new Error("surprise")],
  ] as const)("falls through to the text rule when the reader fails (%s) and counts it", async (label, failure) => {
    const { result, metrics } = await read({ reader: readerOf(failure) });
    expect(result).toMatchObject({ found: true, date: "2026-03-16", method: "text" });
    expect(metrics.recordStampReading).toHaveBeenCalledExactlyOnceWith(label);
  });

  it("falls through to the text rule at once, without calling the API, when the Anthropic circuit is open", async () => {
    const fake = await startFakeAnthropic({ status: 500 });
    try {
      const reader = createAnthropicStampReader({
        apiKey: "test-key",
        model: "claude-sonnet-5-5",
        timeoutMs: 5000,
        maxRetries: 0,
        baseURL: fake.baseURL,
        breaker: { failureThreshold: 1, coolDownMs: 60_000 },
      });
      const first = await read({ reader });
      expect(first.result).toMatchObject({ method: "text" });
      expect(fake.requests).toHaveLength(1);
      const second = await read({ reader });
      expect(second.result).toMatchObject({ found: true, date: "2026-03-16", method: "text" });
      expect(fake.requests).toHaveLength(1);
      expect(second.metrics.recordStampReading).toHaveBeenCalledExactlyOnceWith("error");
    } finally {
      await fake.stop();
    }
  });

  it("falls through to the text rule when the AI finds no stamp", async () => {
    const { result } = await read({ reader: readerOf(reading({ found: false, date: null, stampText: null })) });
    expect(result).toMatchObject({ method: "text" });
  });
});

describe("conformance.read: nothing found, and files that cannot be read", () => {
  it("says so and changes nothing when no step finds a date", async () => {
    const before = await job();
    const { result } = await read({ pages: [["A notice with no stamp and no date."]], allowAi: false });
    expect(result).toEqual({
      found: false,
      date: null,
      method: null,
      stampText: null,
      message:
        "No stamped date could be found on page 1 of Conformance Notification.pdf. Enter the conformed date below.",
    });
    expect(await job()).toEqual(before);
  });

  it("answers 'couldn't be read' for a PDF that cannot be read, as a result and not a failure", async () => {
    const file = await insertFile(db, storage, jobId, {
      bytes: "not a pdf",
      name: "Notice.pdf",
      checkpointKey: "i4_2",
      slot: "conformance",
      scanStatus: "clean",
    });
    const handler = conformanceReadHandler({
      db,
      storage,
      parser: createParser(),
      flags: staticFlags(),
      metrics: { recordStampReading: vi.fn() },
      config: {
        UPLOAD_MAX_BYTES: 1024,
        ANTHROPIC_API_KEY: undefined,
      },
    });
    const op = await enqueue(db, jobId, "conformance.read", { fileId: file.id, allowAi: false });
    const result = await handler.run(handlerContext(op));
    expect(ConformanceReadResult.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      found: false,
      message: "Notice.pdf couldn't be read. Enter the conformed date below.",
    });
  });

  it("fails a time limit instead of calling it unreadable", async () => {
    const slow: Parser = { run: () => Promise.reject(new TaskError("timeout", "Too slow.")) };
    expect((await read({ parser: slow })).error?.code).toBe("timeout");
  });

  it("fails for a file that is not a clean PDF in the 4.2 box, and for an archived job", async () => {
    expect((await read({ scanStatus: "pending" })).error?.code).toBe("file_unavailable");
    await db.updateTable("jobs").set({ deleted_at: new Date() }).where("id", "=", jobId).execute();
    expect((await read({ name: "notice 20260316.pdf" })).error?.code).toBe("job_unavailable");
  });
});
