import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { handlerContext, insertFile } from "../../test/files.js";
import { makeMsg } from "../../test/msg.js";
import { TaskError } from "../errors.js";
import { createParser, type Parser } from "../parsing/isolate.js";
import { emailParseHandler } from "./email-parse.js";

let db: Db;
let jobId: string;
const storage = createMemoryStorage();
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

const EML =
  "Subject: Query about lot 3\r\nFrom: Planner <planner@example.test>\r\nTo: kr@example.test\r\nDate: Mon, 16 Mar 2026 09:30:00 +0800\r\n\r\nPlease advise.\r\n";

async function setup(
  bytes: string | Uint8Array,
  o: { scanStatus?: "clean" | "pending" | "infected"; pasted?: boolean; noObject?: boolean } = {},
) {
  const file = await insertFile(db, storage, jobId, {
    kind: "email",
    bytes,
    checkpointKey: "i4_3",
    slot: "email",
    name: "query.eml",
    scanStatus: o.scanStatus ?? "clean",
    ...(o.noObject ? { noObject: true } : {}),
  });
  await db
    .insertInto("email_messages")
    .values({ file_id: file.id, is_pasted: o.pasted ?? false })
    .execute();
  return file;
}

async function parse(
  fileId: string,
  parser: Parser = createParser(),
  signal?: AbortSignal,
): Promise<{ result?: unknown; error?: TaskError }> {
  const op = await enqueue(db, jobId, "email.parse", { fileId });
  const ctx = handlerContext(op, signal ? { signal } : {});
  const handler = emailParseHandler({ db, storage, parser, config: { UPLOAD_MAX_BYTES: 1024 * 1024 } });
  return handler.run(ctx).then(
    (result) => ({ result }),
    (error: unknown) => ({ error: error as TaskError }),
  );
}

const email = (fileId: string) =>
  db.selectFrom("email_messages").selectAll().where("file_id", "=", fileId).executeTakeFirstOrThrow();
const neverCalled: Parser = { run: () => Promise.reject(new Error("the parser must not run")) };

describe("email.parse", () => {
  it("parses an .eml through the isolated thread and fills email_messages", async () => {
    const file = await setup(EML);
    expect((await parse(file.id)).result).toEqual({ parseStatus: "parsed" });
    expect(await email(file.id)).toMatchObject({
      parse_status: "parsed",
      subject: "Query about lot 3",
      from_text: "Planner <planner@example.test>",
      to_text: "kr@example.test",
      sent_at: new Date("2026-03-16T01:30:00.000Z"),
      is_pasted: false,
    });
    expect((await email(file.id)).body_text).toContain("Please advise.");
  });

  it("parses an Outlook .msg", async () => {
    const file = await setup(
      makeMsg({
        subject: "Re: lot 3",
        body: "See attached plan.",
        to: "kr@example.test",
        sentAt: "2026-03-16T01:30:00.000Z",
      }),
    );
    await parse(file.id);
    expect(await email(file.id)).toMatchObject({
      parse_status: "parsed",
      subject: "Re: lot 3",
      body_text: "See attached plan.",
      sent_at: new Date("2026-03-16T01:30:00.000Z"),
    });
  });

  it("stores no NUL character and cuts an over-long subject to the column limit", async () => {
    const file = await setup(makeMsg({ subject: `a\0b${"x".repeat(1500)}`, body: "text" }));
    await parse(file.id);
    const row = await email(file.id);
    expect(row.parse_status).toBe("parsed");
    expect(row.subject).toHaveLength(1000);
    expect(row.subject).not.toContain("\0");
  });

  it("marks a document that cannot be read as failed and fails with the parser's code", async () => {
    const file = await setup(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3]));
    const { error } = await parse(file.id);
    expect(error).toMatchObject({ code: "invalid_msg", retryable: false });
    expect(await email(file.id)).toMatchObject({ parse_status: "failed", subject: null });
  });

  it("marks the email failed on a time or memory limit, but not when the operation itself was cancelled", async () => {
    const slow: Parser = { run: () => Promise.reject(new TaskError("timeout", "Too slow.")) };
    const file = await setup(EML);
    expect((await parse(file.id, slow)).error?.code).toBe("timeout");
    expect((await email(file.id)).parse_status).toBe("failed");
    const other = await setup(EML);
    const cancelled = AbortSignal.abort();
    await parse(other.id, slow, cancelled);
    expect((await email(other.id)).parse_status).toBe("pending");
  });

  it("marks the email failed when its object is gone", async () => {
    const file = await setup(EML, { noObject: true });
    expect((await parse(file.id, neverCalled)).error?.code).toBe("file_missing");
    expect((await email(file.id)).parse_status).toBe("failed");
  });

  it("leaves a pasted or already parsed email alone and reads nothing for a file that has not passed the scan", async () => {
    const pasted = await setup("Pasted", { pasted: true });
    expect((await parse(pasted.id, neverCalled)).result).toEqual({ parseStatus: "parsed" });
    expect((await email(pasted.id)).parse_status).toBe("pending");
    const infected = await setup(EML, { scanStatus: "infected" });
    expect((await parse(infected.id, neverCalled)).error?.code).toBe("file_not_ready");
    await db.updateTable("files").set({ deleted_at: new Date() }).where("id", "=", pasted.id).execute();
    expect((await parse(pasted.id, neverCalled)).result).toEqual({ parseStatus: "gone" });
  });
});
