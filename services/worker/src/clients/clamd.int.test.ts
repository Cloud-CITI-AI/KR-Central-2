import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_VIRUS, startFakeClamd, type FakeBehaviour, type FakeClamd } from "../../test/fake-clamd.js";
import type { BreakerTuning } from "./circuit-breaker.js";
import { CHUNK_BYTES, ClamdError, createClamdClient, type ClamdClient } from "./clamd.js";

let fake: FakeClamd | undefined;
afterEach(async () => {
  await fake?.stop();
  fake = undefined;
});

async function clientFor(
  behaviour: FakeBehaviour = {},
  overrides: { timeoutMs?: number; maxBytes?: number; breaker?: BreakerTuning } = {},
): Promise<ClamdClient> {
  fake = await startFakeClamd(behaviour);
  return createClamdClient({
    host: "127.0.0.1",
    port: fake.port,
    timeoutMs: 5000,
    maxBytes: 8 * 1024 * 1024,
    ...overrides,
  });
}

const body = (...parts: (string | Buffer)[]): Readable => Readable.from(parts.map((p) => Buffer.from(p)));

async function failure(promise: Promise<unknown>): Promise<ClamdError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ClamdError);
  return error as ClamdError;
}

describe("scan", () => {
  it("reports clean content", async () => {
    const client = await clientFor();
    expect(await client.scan(body("hello ", "world"))).toEqual({ status: "clean" });
    expect(fake?.terminated()).toBe(true);
  });

  it("reports the signature of infected content", async () => {
    const client = await clientFor();
    expect(await client.scan(body("before ", FAKE_VIRUS, " after"))).toEqual({
      status: "infected",
      signature: "Fake.Virus-1",
    });
  });

  it("reports content past a scan limit (AlertExceedsMax) as infected with the signature, not as an error", async () => {
    const client = await clientFor({ reply: "limit-exceeded" });
    expect(await client.scan(body("nested too deep"))).toEqual({
      status: "infected",
      signature: "Heuristics.Limits.Exceeded.MaxRecursion",
    });
  });

  it("sends length-prefixed chunks of at most 64 KiB and ends the stream with a zero-length chunk", async () => {
    const client = await clientFor();
    const data = randomBytes(CHUNK_BYTES * 2 + 100);
    await client.scan(Readable.from([data]));
    expect(fake?.frames).toEqual([CHUNK_BYTES, CHUNK_BYTES, 100]);
    expect(fake?.terminated()).toBe(true);
  });

  it("scans an empty stream", async () => {
    const client = await clientFor();
    expect(await client.scan(body())).toEqual({ status: "clean" });
  });

  it("copes with a slow scanner by waiting for the socket to drain", async () => {
    const client = await clientFor({ slowMs: 20 });
    const data = randomBytes(CHUNK_BYTES * 40);
    expect(await client.scan(Readable.from([data]))).toEqual({ status: "clean" });
    expect(fake?.frames.reduce((a, b) => a + b, 0)).toBe(data.length);
  });

  it("refuses a stream over the configured cap before clamd would, and never ends the stream", async () => {
    const client = await clientFor({}, { maxBytes: CHUNK_BYTES });
    const error = await failure(client.scan(Readable.from([randomBytes(CHUNK_BYTES * 3)])));
    expect(error.code).toBe("size_limit");
    expect(fake?.terminated()).toBe(false);
  });

  it("maps clamd's own size-limit reply to size_limit, even when it closes mid-stream", async () => {
    const client = await clientFor({ streamLimit: CHUNK_BYTES });
    const error = await failure(client.scan(Readable.from([randomBytes(CHUNK_BYTES * 20)])));
    expect(error.code).toBe("size_limit");
  });

  it("maps an ERROR reply to scanner_error with clamd's text as detail", async () => {
    const client = await clientFor({ reply: "scanner-error" });
    const error = await failure(client.scan(body("x")));
    expect(error.code).toBe("scanner_error");
    expect(error.detail).toContain("Can't allocate memory");
  });

  it("maps a reply it does not know, or none, to protocol", async () => {
    expect((await failure((await clientFor({ reply: "garbage" })).scan(body("x")))).code).toBe("protocol");
    await fake?.stop();
    expect((await failure((await clientFor({ reply: "empty-close" })).scan(body("x")))).code).toBe("protocol");
  });

  it("times out when clamd stays silent", async () => {
    const client = await clientFor({ reply: "silent" }, { timeoutMs: 100 });
    expect((await failure(client.scan(body("x")))).code).toBe("timeout");
  });

  it("reports an unreachable clamd as a connection error", async () => {
    const closed = await startFakeClamd();
    await closed.stop();
    const client = createClamdClient({ host: "127.0.0.1", port: closed.port, timeoutMs: 500, maxBytes: 1024 });
    expect((await failure(client.scan(body("x")))).code).toBe("connection");
  });

  it("stops on abort", async () => {
    const client = await clientFor({ reply: "silent" });
    const controller = new AbortController();
    const pending = client.scan(body("x"), controller.signal);
    setTimeout(() => {
      controller.abort();
    }, 20);
    expect((await failure(pending)).code).toBe("aborted");
    expect((await failure(client.scan(body("x"), AbortSignal.abort()))).code).toBe("aborted");
  });

  it("passes on an error of the source stream and releases the connection", async () => {
    const client = await clientFor();
    const broken = new Readable({
      read() {
        this.destroy(new Error("storage went away"));
      },
    });
    await expect(client.scan(broken)).rejects.toThrow("storage went away");
  });
});

describe("ping", () => {
  it("is true on PONG and false when clamd is not there", async () => {
    const client = await clientFor();
    expect(await client.ping()).toBe(true);
    await fake?.stop();
    expect(await client.ping()).toBe(false);
  });
});

describe("the circuit breaker", () => {
  async function closedPort(): Promise<number> {
    const closed = await startFakeClamd();
    await closed.stop();
    return closed.port;
  }

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

  it("opens after consecutive connection failures and then fails fast as a connection error, without connecting", async () => {
    const c = clocked();
    const client = createClamdClient({
      host: "127.0.0.1",
      port: await closedPort(),
      timeoutMs: 500,
      maxBytes: 1024,
      breaker: c.breaker,
    });
    expect((await failure(client.scan(body("x")))).detail).toBe("ECONNREFUSED");
    expect((await failure(client.scan(body("x")))).detail).toBe("ECONNREFUSED");
    expect(client.circuit).toBe("open");
    const source = body("x");
    const error = await failure(client.scan(source));
    expect(error).toMatchObject({ code: "connection", detail: "circuit_open" });
    expect(source.destroyed).toBe(true);
    expect(c.changes).toEqual(["closed>open"]);
  });

  it("opens after consecutive timeouts", async () => {
    const c = clocked();
    const client = await clientFor({ reply: "silent" }, { timeoutMs: 100, breaker: c.breaker });
    expect((await failure(client.scan(body("x")))).code).toBe("timeout");
    expect((await failure(client.scan(body("x")))).code).toBe("timeout");
    expect((await failure(client.scan(body("x")))).detail).toBe("circuit_open");
    expect(client.circuit).toBe("open");
  });

  it("does not count verdicts, clamd's own errors, aborts or a failing source stream", async () => {
    const c = clocked();
    const client = await clientFor({ reply: "scanner-error" }, { breaker: c.breaker });
    for (let i = 0; i < 4; i += 1) expect((await failure(client.scan(body("x")))).code).toBe("scanner_error");
    const broken = () =>
      new Readable({
        read() {
          this.destroy(new Error("storage went away"));
        },
      });
    for (let i = 0; i < 4; i += 1) await expect(client.scan(broken())).rejects.toThrow("storage went away");
    for (let i = 0; i < 4; i += 1)
      expect((await failure(client.scan(body("x"), AbortSignal.abort()))).code).toBe("aborted");
    expect(client.circuit).toBe("closed");
    expect(c.changes).toEqual([]);
  });

  it("scans again after the cool-down: a successful trial closes the circuit, a failed one opens it again", async () => {
    const c = clocked();
    const gone = await startFakeClamd();
    const port = gone.port;
    await gone.stop();
    const client = createClamdClient({ host: "127.0.0.1", port, timeoutMs: 500, maxBytes: 1024, breaker: c.breaker });
    await failure(client.scan(body("x")));
    await failure(client.scan(body("x")));
    c.advance(1000);
    expect((await failure(client.scan(body("x")))).detail).toBe("ECONNREFUSED"); // the trial went out and failed
    expect((await failure(client.scan(body("x")))).detail).toBe("circuit_open");
    expect(c.changes).toEqual(["closed>open", "open>half_open", "half_open>open"]);

    // clamd comes back where it was: after the next cool-down the trial scan succeeds and the circuit closes
    fake = await startFakeClamd({ port });
    c.advance(1000);
    expect(await client.scan(body("fine"))).toEqual({ status: "clean" });
    expect(client.circuit).toBe("closed");
    expect(await client.scan(body("fine again"))).toEqual({ status: "clean" });
    expect(c.changes.slice(3)).toEqual(["open>half_open", "half_open>closed"]);
  });

  it("leaves the PING probe alone", async () => {
    const c = clocked();
    const client = createClamdClient({
      host: "127.0.0.1",
      port: await closedPort(),
      timeoutMs: 500,
      maxBytes: 1024,
      breaker: c.breaker,
    });
    for (let i = 0; i < 3; i += 1) expect(await client.ping()).toBe(false);
    expect(client.circuit).toBe("closed");
  });
});
