/**
 * Process lifecycle for main.ts (BE-11): log and exit on unhandled failures, and on SIGTERM stop claiming work, let
 * in-flight work finish for up to 25 s, then close the connections and flush telemetry. Kept out of main.ts so the
 * pieces are unit-testable.
 */
import type { Logger } from "@kr/logger";
import { describeError } from "../errors.js";

export const SHUTDOWN_TIMEOUT_MS = 25_000;

export interface ShutdownDeps {
  /** Stops claiming and resolves when in-flight work is done, or `false` when it did not finish within `timeoutMs`. */
  readonly drain: (timeoutMs: number) => Promise<boolean>;
  /** Closed in order after the drain: health server, database pool, telemetry. */
  readonly closers: readonly (() => Promise<unknown>)[];
  readonly log: Logger;
  readonly exit: (code: number) => void;
  readonly timeoutMs?: number;
}

/** Returns an idempotent shutdown(signal); exit code 0, or 1 when work was still running or a closer failed. */
export function createShutdown(d: ShutdownDeps): (signal: string) => Promise<void> {
  let running: Promise<void> | undefined;
  return (signal) => {
    running ??= (async () => {
      const limit = d.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
      d.log.info({ event: "shutdown_started", signal }, "Shutting down");
      const timer = setTimeout(() => {
        d.log.error({ event: "shutdown_timeout" }, "Graceful shutdown timed out");
        d.exit(1);
      }, limit + 2000);
      timer.unref();
      let code = 0;
      try {
        if (!(await d.drain(limit))) {
          code = 1;
          d.log.warn({ event: "shutdown_work_abandoned" }, "In-flight work did not finish; its leases will expire");
        }
        for (const close of d.closers) await close();
      } catch (err) {
        code = 1;
        d.log.error({ event: "shutdown_failed", ...describeError(err) }, "Shutdown failed");
      }
      clearTimeout(timer);
      d.exit(code);
    })();
    return running;
  };
}

/** Log and exit on unhandled failures: never keep working in an unknown state (BE-11). */
export function installCrashGuards(
  log: Logger,
  exit: (code: number) => void,
  proc: NodeJS.EventEmitter = process,
): void {
  proc.on("unhandledRejection", (reason) => {
    log.fatal({ event: "unhandled_rejection", ...describeError(reason) }, "Unhandled promise rejection");
    exit(1);
  });
  proc.on("uncaughtException", (err) => {
    log.fatal({ event: "uncaught_exception", ...describeError(err) }, "Uncaught exception");
    exit(1);
  });
}

/** "k1=v1,k2=v2" (OTEL_EXPORTER_OTLP_HEADERS) to a record; malformed pairs are dropped. */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const i = pair.indexOf("=");
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}
