/**
 * Personal-data scrubbing for spans (PRODUCT_SPEC §14 "No personal data in logs/telemetry", X7). Instrumentations
 * record URLs, client addresses, user agents and exception messages (a Postgres unique violation quotes the
 * offending value); none of that may leave the process, so every span passes through here before export.
 */
import type { Attributes, AttributeValue } from "@opentelemetry/api";
import type { tracing } from "@opentelemetry/sdk-node";

export const REDACTED = "[redacted]";

const DROPPED_KEYS = new Set([
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
]);
const DROPPED_PREFIXES = ["enduser.", "user.", "http.request.header.", "http.response.header.", "db.query.parameter."];
const URL_KEYS = new Set(["url.full", "http.url", "http.target", "url.path"]);
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

function scrubValue(value: AttributeValue): AttributeValue {
  if (typeof value === "string") return EMAIL.test(value) ? REDACTED : value;
  if (Array.isArray(value))
    return value.map((v) => (typeof v === "string" && EMAIL.test(v) ? REDACTED : v)) as AttributeValue;
  return value;
}

/** Drops personal-data attribute keys, removes URL query strings and redacts anything shaped like an email. */
export function scrubAttributes(attributes: Attributes): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || DROPPED_KEYS.has(key) || DROPPED_PREFIXES.some((p) => key.startsWith(p))) continue;
    out[key] =
      URL_KEYS.has(key) && typeof value === "string" ? scrubValue(value.split(/[?#]/, 1)[0] ?? "") : scrubValue(value);
  }
  return out;
}

/** A copy of the span with scrubbed attributes and events and no free-text status message (it quotes error text). */
export function scrubSpan(span: tracing.ReadableSpan): tracing.ReadableSpan {
  const parent = span.parentSpanContext;
  return {
    name: span.name,
    kind: span.kind,
    spanContext: () => span.spanContext(),
    ...(parent ? { parentSpanContext: parent } : {}),
    startTime: span.startTime,
    endTime: span.endTime,
    status: { code: span.status.code },
    attributes: scrubAttributes(span.attributes),
    links: span.links.map((l) => ({
      context: l.context,
      ...(l.attributes ? { attributes: scrubAttributes(l.attributes) } : {}),
    })),
    events: span.events.map((e) => ({ ...e, attributes: scrubAttributes(e.attributes ?? {}) })),
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

/** Wraps a span exporter so nothing reaches it unscrubbed. */
export class ScrubbingSpanExporter implements tracing.SpanExporter {
  constructor(private readonly inner: tracing.SpanExporter) {}
  export(spans: tracing.ReadableSpan[], done: Parameters<tracing.SpanExporter["export"]>[1]): void {
    this.inner.export(spans.map(scrubSpan), done);
  }
  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
