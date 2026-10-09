import { SpanStatusCode, type Span } from "@opentelemetry/api";
import { tracing } from "@opentelemetry/sdk-node";
import { describe, expect, it } from "vitest";
import { REDACTED, ScrubbingSpanExporter, scrubAttributes } from "./scrub.js";

function exportOne(configure: (span: Span) => void) {
  const memory = new tracing.InMemorySpanExporter();
  const provider = new tracing.BasicTracerProvider({
    spanProcessors: [new tracing.SimpleSpanProcessor(new ScrubbingSpanExporter(memory))],
  });
  const span = provider.getTracer("test").startSpan("GET /v1/jobs");
  configure(span);
  span.end();
  const [exported] = memory.getFinishedSpans();
  if (!exported) throw new Error("no span exported");
  return exported;
}

describe("scrubAttributes", () => {
  it("drops personal-data keys and keeps operational ones", () => {
    const out = scrubAttributes({
      "http.request.method": "GET",
      "http.route": "/v1/jobs/:id",
      "user_agent.original": "Mozilla/5.0",
      "client.address": "203.0.113.9",
      "enduser.id": "u-1",
      "http.request.header.cookie": "sid=abc",
      "db.query.parameter.1": "someone",
      "url.query": "q=someone",
    });
    expect(out).toEqual({ "http.request.method": "GET", "http.route": "/v1/jobs/:id" });
  });

  it("removes query strings and fragments from URL attributes", () => {
    const out = scrubAttributes({
      "url.full": "https://api.test/v1/jobs?search=lot&token=t#x",
      "http.target": "/v1/jobs?x=1",
      "url.path": "/v1/jobs?email=a@b.com&x=1#frag",
    });
    expect(out).toEqual({ "url.full": "https://api.test/v1/jobs", "http.target": "/v1/jobs", "url.path": "/v1/jobs" });
  });

  it("redacts email-shaped values, also inside arrays, and keeps other types", () => {
    const out = scrubAttributes({
      a: "jo.bloggs+x@example.test",
      b: ["ok", "x@y.test"],
      c: 3,
      d: true,
      e: "no at sign",
    });
    expect(out).toEqual({ a: REDACTED, b: ["ok", REDACTED], c: 3, d: true, e: "no at sign" });
  });
});

describe("ScrubbingSpanExporter", () => {
  it("scrubs span attributes, events and the status message before export", () => {
    const exported = exportOne((span) => {
      span.setAttributes({
        "url.full": "https://x.test/a?email=a@b.test",
        "client.address": "198.51.100.1",
        ok: "yes",
      });
      span.recordException(Object.assign(new Error("Key (email)=(a@b.test) already exists."), { code: "23505" }));
      span.setStatus({ code: SpanStatusCode.ERROR, message: "duplicate key for a@b.test" });
    });
    expect(exported.attributes).toEqual({ "url.full": "https://x.test/a", ok: "yes" });
    expect(exported.status).toEqual({ code: SpanStatusCode.ERROR });
    const [event] = exported.events;
    expect(event?.name).toBe("exception");
    expect(event?.attributes).toEqual({ "exception.type": "23505" });
    expect(JSON.stringify(exported.events)).not.toContain("a@b.test");
    expect(exported.name).toBe("GET /v1/jobs");
    expect(exported.spanContext().traceId).toHaveLength(32);
  });

  it("forwards shutdown and flush to the wrapped exporter", async () => {
    const calls: string[] = [];
    const inner: tracing.SpanExporter = {
      export: () => undefined,
      shutdown: () => Promise.resolve(void calls.push("shutdown")),
      forceFlush: () => Promise.resolve(void calls.push("flush")),
    };
    const exporter = new ScrubbingSpanExporter(inner);
    await exporter.forceFlush();
    await exporter.shutdown();
    expect(calls).toEqual(["flush", "shutdown"]);
    await expect(
      new ScrubbingSpanExporter({ export: () => undefined, shutdown: () => Promise.resolve() }).forceFlush(),
    ).resolves.toBeUndefined();
  });
});
