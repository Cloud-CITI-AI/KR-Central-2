import { describe, expect, it } from "vitest";
import { makePdf } from "../../test/pdf.js";
import { TaskError } from "../errors.js";
import { DEFAULT_PARSE_LIMITS, createParser, isUnreadable, runInThread } from "./isolate.js";

const misbehaving = new URL("../../test/fixtures/misbehaving-thread.ts", import.meta.url);
const parser = createParser();

async function failure(promise: Promise<unknown>): Promise<TaskError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(TaskError);
  return error as TaskError;
}

describe("the parse thread", () => {
  it("reads the text of every page and the first page alone", async () => {
    const data = await makePdf([["Page one line"], ["Page two line"]]);
    const all = await parser.run("pdf-text", { data, maxPages: 10 });
    expect(all.filter(Boolean)).toEqual(["Page one line", "Page two line"]);
    const first = await parser.run("pdf-first-page", { data, maxPages: 10 });
    expect(first.lines).toEqual(["Page one line"]);
  });

  it("renders page 1 to a PNG", async () => {
    const data = await makePdf([["Stamp"]]);
    const png = await parser.run("pdf-render", { data, maxPages: 10 });
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("parses an .eml", async () => {
    const data = new TextEncoder().encode(
      "Subject: Query\r\nFrom: a@example.test\r\nTo: b@example.test\r\n\r\nPlease advise.\r\n",
    );
    const email = await parser.run("email", { data });
    expect(email).toMatchObject({ subject: "Query", from: "a@example.test" });
    expect(email.body).toContain("Please advise.");
  });

  it("reports an unreadable document with the parser's code", async () => {
    const notPdf = await failure(parser.run("pdf-text", { data: new TextEncoder().encode("hello"), maxPages: 10 }));
    expect(notPdf).toMatchObject({ code: "not_a_pdf", retryable: false });
    expect(isUnreadable(notPdf)).toBe(true);
    const long = await makePdf([["a"], ["b"], ["c"]]);
    expect((await failure(parser.run("pdf-text", { data: long, maxPages: 2 }))).code).toBe("too_many_pages");
  });
});

describe("the limits", () => {
  const limits = { ...DEFAULT_PARSE_LIMITS, timeoutMs: 300 };

  it("terminates a thread that never finishes at the time limit", async () => {
    const started = Date.now();
    const error = await failure(runInThread({ mode: "loop" }, limits, undefined, misbehaving));
    expect(error.code).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(isUnreadable(error)).toBe(false);
  });

  it("fails cleanly when the thread runs out of memory", async () => {
    const error = await failure(
      runInThread(
        { mode: "alloc" },
        { ...limits, timeoutMs: 20_000, maxOldGenerationSizeMb: 32 },
        undefined,
        misbehaving,
      ),
    );
    expect(error.code).toBe("too_complex");
  });

  it("also stops a thread that hoards off-heap memory, which V8's heap limit does not see", async () => {
    const small = { ...limits, timeoutMs: 20_000, maxOldGenerationSizeMb: 32 };
    expect((await failure(runInThread({ mode: "buffers" }, small, undefined, misbehaving))).code).toBe("too_complex");
  });

  it("fails cleanly when the thread dies without an answer", async () => {
    expect((await failure(runInThread({ mode: "exit" }, limits, undefined, misbehaving))).code).toBe("parse_failed");
  });

  it("stops on abort with the abort reason, and does not start when already aborted", async () => {
    const controller = new AbortController();
    const pending = runInThread({ mode: "loop" }, { ...limits, timeoutMs: 20_000 }, controller.signal, misbehaving);
    setTimeout(() => {
      controller.abort(new TaskError("lease_lost", "Lost.", { retryable: true }));
    }, 50);
    expect((await failure(pending)).code).toBe("lease_lost");
    const done = AbortSignal.abort(new TaskError("timeout", "Too slow."));
    expect((await failure(runInThread({ mode: "loop" }, limits, done, misbehaving))).code).toBe("timeout");
  });

  it("gives the thread an empty environment, so it cannot see the database URL or a key", async () => {
    expect(await runInThread({ mode: "env" }, limits, undefined, misbehaving)).toEqual([]);
  });
});
