import { createLogger, type Logger } from "@kr/logger";

export interface CapturedLog {
  readonly log: Logger;
  /** Parsed JSON log lines written so far. */
  readonly lines: Record<string, unknown>[];
  /** The `event` of every line, in order. */
  readonly events: () => unknown[];
}

/** A real pino logger writing into memory, so tests can assert on what was logged. */
export function captureLog(): CapturedLog {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "kr-worker",
    env: "local",
    level: "debug",
    destination: {
      write(chunk: string): void {
        lines.push(JSON.parse(chunk) as Record<string, unknown>);
      },
    },
  });
  return { log, lines, events: () => lines.map((l) => l.event) };
}
