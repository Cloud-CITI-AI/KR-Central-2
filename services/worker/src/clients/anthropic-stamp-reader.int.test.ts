import { afterEach, describe, expect, it } from "vitest";
import { startFakeAnthropic, type FakeAnthropic, type Reply } from "../../test/fake-anthropic.js";
import { STAMP_PROMPT, createAnthropicStampReader } from "./anthropic-stamp-reader.js";
import { StampReaderError, type StampReading } from "./stamp-reader.js";

let fake: FakeAnthropic | undefined;
afterEach(async () => {
  await fake?.stop();
  fake = undefined;
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

async function read(reply: Reply, o: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<StampReading> {
  fake = await startFakeAnthropic(reply);
  const reader = createAnthropicStampReader({
    apiKey: "test-key",
    model: "claude-sonnet-5-5",
    timeoutMs: o.timeoutMs ?? 5000,
    baseURL: fake.baseURL,
  });
  return reader.read(PNG, o.signal);
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  );
}

const answer = (o: object): Reply => ({ text: JSON.stringify(o) });

describe("the Anthropic stamp reader", () => {
  it("returns the stamped date and text, and sends one image and the instruction only", async () => {
    const reading = await read(answer({ found: true, date: "2026-03-16", stampText: "DATE 16-Mar-2026 FILE 123-26" }));
    expect(reading).toEqual({ found: true, date: "2026-03-16", stampText: "DATE 16-Mar-2026 FILE 123-26" });
    const request = fake?.requests[0];
    expect(request?.headers["x-api-key"]).toBe("test-key");
    expect(request?.body).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 1024,
      output_config: { effort: "low", format: { type: "json_schema" } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: Buffer.from(PNG).toString("base64") },
            },
            { type: "text", text: STAMP_PROMPT },
          ],
        },
      ],
    });
    expect(Object.keys(request?.body ?? {}).sort()).toEqual(["max_tokens", "messages", "model", "output_config"]);
  });

  it("returns not found when the model sees no stamp", async () => {
    expect(await read(answer({ found: false, date: null, stampText: null }))).toEqual({
      found: false,
      date: null,
      stampText: null,
    });
  });

  it("cuts an over-long stamp text", async () => {
    const reading = await read(answer({ found: true, date: "2026-03-16", stampText: "x".repeat(500) }));
    expect(reading.stampText).toHaveLength(200);
  });

  it.each([
    ["a date that is not on the calendar", answer({ found: true, date: "2026-02-30", stampText: "x" })],
    ["no date although a stamp was found", answer({ found: true, date: null, stampText: "x" })],
    ["output that is not the schema", answer({ found: "maybe" })],
    ["output that is not JSON", { text: "It says sixteenth of March." }],
  ] as const)("calls %s unparseable", async (_name, reply) => {
    expect(await failure(read(reply))).toMatchObject({ reason: "unparseable" });
  });

  it("calls a refusal refused", async () => {
    expect(await failure(read({ text: "", stopReason: "refusal" }))).toMatchObject({ reason: "refused" });
  });

  it("calls an API error an error", async () => {
    expect(await failure(read({ status: 400 }))).toMatchObject({ reason: "error" });
  });

  it("gives up at the time limit, retries included", async () => {
    const started = Date.now();
    expect(await failure(read("hang", { timeoutMs: 300 }))).toMatchObject({ reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("passes on the caller's own abort instead of calling it a failure of the reader", async () => {
    const error = await failure(read("hang", { signal: AbortSignal.abort(new Error("cancelled")) }));
    expect(error).not.toBeInstanceOf(StampReaderError);
  });
});
