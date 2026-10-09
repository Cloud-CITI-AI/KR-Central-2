import { context, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { tracing } from "@opentelemetry/sdk-node";
import { describe, expect, it } from "vitest";
import { DROPPED_KEYS, DROPPED_PREFIXES, REDACTED, ScrubbingSpanExporter, scrubAttributes, URL_KEYS } from "./scrub.js";

// Spelled out on purpose: deriving these from the exports would let a blanked entry pass its own test.
const PERSONAL_KEYS = [
  "url.query",
  "user_agent.original",
  "http.user_agent",
  "client.address",
  "client.port",
  "http.client_ip",
  "net.peer.ip",
  "net.sock.peer.addr",
  "network.peer.address",
  "exception.message",
  "exception.stacktrace",
];
const PERSONAL_PREFIXES = ["enduser.", "user.", "http.request.header.", "http.response.header.", "db.query.parameter."];
const URL_ATTRIBUTES = ["url.full", "http.url", "http.target", "url.path"];

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

  it("lists exactly the expected personal-data keys, prefixes and URL attributes", () => {
    expect([...DROPPED_KEYS].sort()).toEqual([...PERSONAL_KEYS].sort());
    expect([...DROPPED_PREFIXES].sort()).toEqual([...PERSONAL_PREFIXES].sort());
    expect([...URL_KEYS].sort()).toEqual([...URL_ATTRIBUTES].sort());
    expect(REDACTED).toBe("[redacted]");
  });

  it.each(PERSONAL_KEYS)("drops the personal-data key %s", (key) => {
    expect(scrubAttributes({ [key]: "value", keep: "yes" })).toEqual({ keep: "yes" });
  });

  it.each(PERSONAL_PREFIXES)("drops every key under the prefix %s", (prefix) => {
    expect(scrubAttributes({ [`${prefix}anything`]: "value", keep: "yes" })).toEqual({ keep: "yes" });
  });

  it("keeps keys that merely resemble a dropped prefix", () => {
    expect(scrubAttributes({ username: "x", "users.count": 3 })).toEqual({ username: "x", "users.count": 3 });
  });

  it.each(URL_ATTRIBUTES)("strips the query string and fragment from %s", (key) => {
    expect(scrubAttributes({ [key]: "/v1/jobs/42?name=Jo%20Bloggs&x=1#frag" })).toEqual({ [key]: "/v1/jobs/42" });
    expect(scrubAttributes({ [key]: "/v1/jobs/42#frag?x=1" })).toEqual({ [key]: "/v1/jobs/42" });
    expect(scrubAttributes({ [key]: "/v1/jobs/42" })).toEqual({ [key]: "/v1/jobs/42" });
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

  it("scrubs the attributes of span links", () => {
    const memory = new tracing.InMemorySpanExporter();
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: [new tracing.SimpleSpanProcessor(new ScrubbingSpanExporter(memory))],
    });
    const tracer = provider.getTracer("test");
    const other = tracer.startSpan("other");
    other.end();
    const span = tracer.startSpan("linked", {
      links: [
        {
          context: other.spanContext(),
          attributes: {
            "client.address": "198.51.100.1",
            "url.full": "https://x.test/a?q=1",
            who: "a@b.test",
            ok: "yes",
          },
        },
        { context: other.spanContext() },
      ],
    });
    span.end();
    const linked = memory.getFinishedSpans().find((s) => s.name === "linked");
    expect(linked?.links).toHaveLength(2);
    expect(linked?.links[0]?.attributes).toEqual({ "url.full": "https://x.test/a", who: REDACTED, ok: "yes" });
    expect(linked?.links[0]?.context).toEqual(other.spanContext());
    expect(linked?.links[1]?.attributes).toBeUndefined();
  });

  it("keeps the parent span context of a child span and omits it on a root span", () => {
    const memory = new tracing.InMemorySpanExporter();
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: [new tracing.SimpleSpanProcessor(new ScrubbingSpanExporter(memory))],
    });
    const tracer = provider.getTracer("test");
    const parent = tracer.startSpan("parent");
    const child = tracer.startSpan("child", {}, trace.setSpan(context.active(), parent));
    child.end();
    parent.end();
    const [exportedChild, exportedParent] = memory.getFinishedSpans();
    expect(exportedChild?.name).toBe("child");
    expect(exportedChild?.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(exportedChild?.parentSpanContext?.traceId).toBe(parent.spanContext().traceId);
    expect(exportedChild?.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect(exportedParent?.parentSpanContext).toBeUndefined();
    expect(exportedParent && "parentSpanContext" in exportedParent).toBe(false);
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
