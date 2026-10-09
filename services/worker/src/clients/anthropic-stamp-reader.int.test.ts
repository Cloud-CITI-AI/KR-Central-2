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

describe("the circuit breaker", () => {
  const OPTIONS = { apiKey: "test-key", model: "claude-sonnet-5-5", timeoutMs: 5000, maxRetries: 0 } as const;
  const found = answer({ found: true, date: "2026-03-16", stampText: "DATE 16-Mar-2026" });

  function clocked() {
    let now = new Date("2026-10-09T08:00:00.000Z");
    const changes: string[] = [];
    return {
      changes,
      advance: (ms: number) => {
        now = new Date(now.getTime() + ms);
      },
      breaker: {
        failureThreshold: 2,
        coolDownMs: 1000,
        clock: { now: () => now },
        onStateChange: ({ from, to }: { from: string; to: string }) => changes.push(`${from}>${to}`),
      },
    };
  }

  it("opens after consecutive server errors, then fails fast as an 'error' without calling the API", async () => {
    fake = await startFakeAnthropic({ status: 503 });
    const c = clocked();
    const reader = createAnthropicStampReader({ ...OPTIONS, baseURL: fake.baseURL, breaker: c.breaker });
    expect(await failure(reader.read(PNG))).toMatchObject({ reason: "error", unavailable: true });
    expect(await failure(reader.read(PNG))).toMatchObject({ reason: "error", unavailable: true });
    expect(fake.requests).toHaveLength(2);
    const open = await failure(reader.read(PNG));
    expect(open).toBeInstanceOf(StampReaderError);
    expect(open).toMatchObject({ reason: "error", unavailable: true });
    expect(fake.requests).toHaveLength(2);
    expect(c.changes).toEqual(["closed>open"]);
  });

  it("counts timeouts and unreachable hosts too, but not a bad request, a refusal or unparseable output", async () => {
    const c = clocked();
    fake = await startFakeAnthropic({ status: 400 });
    const bad = createAnthropicStampReader({ ...OPTIONS, baseURL: fake.baseURL, breaker: c.breaker });
    for (let i = 0; i < 4; i += 1) expect(await failure(bad.read(PNG))).toMatchObject({ unavailable: false });
    expect(fake.requests).toHaveLength(4);
    await fake.stop();

    fake = await startFakeAnthropic("hang");
    const slow = createAnthropicStampReader({
      ...OPTIONS,
      timeoutMs: 100,
      baseURL: fake.baseURL,
      breaker: c.breaker,
    });
    expect(await failure(slow.read(PNG))).toMatchObject({ reason: "timeout", unavailable: true });
    expect(await failure(slow.read(PNG))).toMatchObject({ reason: "timeout", unavailable: true });
    expect(fake.requests).toHaveLength(2);
    await failure(slow.read(PNG));
    expect(fake.requests).toHaveLength(2);
    expect(c.changes).toEqual(["closed>open"]);

    await fake.stop();
    fake = undefined;
    const gone = await startFakeAnthropic(found);
    const baseURL = gone.baseURL;
    await gone.stop();
    const unreachable = createAnthropicStampReader({ ...OPTIONS, baseURL, breaker: { ...c.breaker } });
    expect(await failure(unreachable.read(PNG))).toMatchObject({ unavailable: true });
  });

  it("allows one trial call after the cool-down: it re-opens the circuit when it fails and closes it when it succeeds", async () => {
    fake = await startFakeAnthropic({ status: 500 });
    const c = clocked();
    const reader = createAnthropicStampReader({ ...OPTIONS, baseURL: fake.baseURL, breaker: c.breaker });
    await failure(reader.read(PNG));
    await failure(reader.read(PNG));
    c.advance(1000);
    expect(await failure(reader.read(PNG))).toMatchObject({ unavailable: true });
    expect(fake.requests).toHaveLength(3); // the trial call reached the API and failed
    await failure(reader.read(PNG));
    expect(fake.requests).toHaveLength(3); // open again, for a full cool-down

    fake.respondWith(found);
    c.advance(1000);
    expect((await reader.read(PNG)).found).toBe(true);
    expect((await reader.read(PNG)).found).toBe(true);
    expect(fake.requests).toHaveLength(5);
    expect(c.changes).toEqual([
      "closed>open",
      "open>half_open",
      "half_open>open",
      "open>half_open",
      "half_open>closed",
    ]);
  });
});
