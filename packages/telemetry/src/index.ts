/**
 * OpenTelemetry bootstrap (playbook OB-1/OB-2). Import and call startTelemetry() FIRST in each service entry point
 * (before fastify/pg are imported) so auto-instrumentation can patch them.
 * Export is disabled unless OTEL_EXPORTER_OTLP_ENDPOINT is configured (external backend = X7 approval, ADR-0009).
 * Full implementation: work package WP-15 (observability).
 */
export interface TelemetryConfig {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly environment: string;
  /** OTLP/HTTP base URL; undefined disables export (spans still created for log correlation). */
  readonly otlpEndpoint?: string | undefined;
  /** Extra OTLP headers, e.g. authorization for the backend. */
  readonly otlpHeaders?: Readonly<Record<string, string>>;
}

export interface TelemetryHandle {
  shutdown(): Promise<void>;
}

export function startTelemetry(_config: TelemetryConfig): TelemetryHandle {
  return { shutdown: () => Promise.resolve() };
}
