import { isSpanContextValid, trace } from "@opentelemetry/api";

export interface TraceIds {
  readonly traceId: string;
  readonly spanId: string;
}

/**
 * Trace and span id of the active span for log correlation (ADR-0009): `requestLogger(log, { requestId,
 * traceId: currentTraceIds()?.traceId })`. Undefined when telemetry is off or there is no active span.
 */
export function currentTraceIds(): TraceIds | undefined {
  const context = trace.getActiveSpan()?.spanContext();
  if (!context || !isSpanContextValid(context)) return undefined;
  return { traceId: context.traceId, spanId: context.spanId };
}
