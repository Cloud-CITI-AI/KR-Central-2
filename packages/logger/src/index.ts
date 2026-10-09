/**
 * The only logger factory (playbook LG-1..5, BE-12): structured JSON to stdout, one event per line, with
 * service/env on every line, requestId/traceId via child loggers, and redaction of secrets and personal data.
 * Convention: logger.info({ event: "job.created", jobId }, "Job created") — `event` is a stable snake/dot name.
 */
import { createHash } from "node:crypto";
import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger } from "pino";

/** Paths censored in every log line (LG-3). Add, never remove. */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "secret",
  "*.secret",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "idToken",
  "*.idToken",
  "refreshToken",
  "*.refreshToken",
  "code",
  "code_verifier",
  "csrfToken",
  "*.csrfToken",
  "email",
  "*.email",
  "phone",
  "*.phone",
  "address",
  "*.address",
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  "headers.authorization",
  "headers.cookie",
];

export interface LoggerConfig {
  readonly service: string;
  readonly env: string;
  readonly level?: "debug" | "info" | "warn" | "error";
  /** Override destination (tests). */
  readonly destination?: pino.DestinationStream;
}

export function createLogger(cfg: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level: cfg.level ?? "info",
    base: { service: cfg.service, env: cfg.env },
    messageKey: "msg",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  };
  return cfg.destination ? pino(options, cfg.destination) : pino(options);
}

/** Child logger bound to a request (LG-2). */
export function requestLogger(
  base: Logger,
  ctx: { requestId: string; traceId?: string | undefined; userId?: string | undefined },
): Logger {
  return base.child({
    requestId: ctx.requestId,
    ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  });
}

/** Stable pseudonym for correlating an identifier (e.g. an email in a security event) without logging it. */
export function pseudonymise(value: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${value.toLowerCase()}`).digest("hex").slice(0, 16);
}
