/**
 * Process lifecycle for main.ts: start listening, install crash guards (BE-11) and shut down gracefully on SIGTERM
 * within 25 s. Kept out of main.ts so the pieces are unit-testable.
 */
import type { Logger } from "@kr/logger";
import type { TelemetryHandle } from "@kr/telemetry";

export const SHUTDOWN_TIMEOUT_MS = 25_000;

export interface ShutdownDeps {
  readonly app: { close(): Promise<unknown> };
  readonly closers: readonly (() => Promise<unknown>)[];
  readonly telemetry: TelemetryHandle;
  readonly log: Logger;
  readonly exit: (code: number) => void;
  readonly timeoutMs?: number;
}

/** Returns an idempotent shutdown(signal): stop accepting, drain, close pools, flush telemetry, exit 0 (1 on timeout/error). */
export function createShutdown(d: ShutdownDeps): (signal: string) => Promise<void> {
  let running: Promise<void> | undefined;
  return (signal) => {
    running ??= (async () => {
      d.log.info({ event: "shutdown_started", signal }, "Shutting down");
      const timer = setTimeout(() => {
        d.log.error({ event: "shutdown_timeout" }, "Graceful shutdown timed out");
        d.exit(1);
      }, d.timeoutMs ?? SHUTDOWN_TIMEOUT_MS);
      timer.unref();
      try {
        await d.app.close();
        for (const close of d.closers) await close();
        await d.telemetry.shutdown();
        clearTimeout(timer);
        d.exit(0);
      } catch (err) {
        d.log.error({ event: "shutdown_failed", err }, "Shutdown failed");
        d.exit(1);
      }
    })();
    return running;
  };
}

/** Log and exit on unhandled failures: never keep serving in an unknown state (BE-11). */
export function installCrashGuards(
  log: Logger,
  exit: (code: number) => void,
  proc: NodeJS.EventEmitter = process,
): void {
  proc.on("unhandledRejection", (reason) => {
    log.fatal({ event: "unhandled_rejection", err: reason }, "Unhandled promise rejection");
    exit(1);
  });
  proc.on("uncaughtException", (err) => {
    log.fatal({ event: "uncaught_exception", err }, "Uncaught exception");
    exit(1);
  });
}

/** "k1=v1,k2=v2" (OTEL_EXPORTER_OTLP_HEADERS) → record; malformed pairs are dropped. */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const i = pair.indexOf("=");
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}
