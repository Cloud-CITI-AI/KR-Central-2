import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { handlerContext, insertFile } from "../../test/files.js";
import { makePdf } from "../../test/pdf.js";
import type { StampReader, StampReading } from "../clients/stamp-reader.js";
import type { TaskError } from "../errors.js";
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
}

async function read(o: Options = {}) {
  const file = await insertFile(db, storage, jobId, {
    bytes: await makePdf(o.pages ?? [CONFORMED_LINE], o.annotation),
    name: o.name ?? "Conformance Notification.pdf",
    checkpointKey: "i4_2",
    slot: "conformance",
    scanStatus: "clean",
  });
  const metrics = { recordStampReading: vi.fn() };
  const handler = conformanceReadHandler({
    db,
    storage,
    parser: o.parser ?? createParser(),
    stampReader: o.reader,
    metrics,
    config: {
      UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
      PDF_MAX_PAGES: 60,
      FEATURE_AI_STAMP_READING: o.flag ?? true,
      ANTHROPIC_API_KEY: "key" in o ? o.key : "test-key",
    },
  });
  const op = await enqueue(db, jobId, "conformance.read", { fileId: file.id, allowAi: o.allowAi ?? true });
  const outcome = await handler.run(handlerContext(op)).then(
    (result) => ({ result: result as Record<string, unknown>, error: undefined }),
    (error: unknown) => ({ result: undefined, error: error as TaskError }),
  );
  return { file, metrics, ...outcome };
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
