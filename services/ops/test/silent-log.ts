import { createLogger, type Logger } from "@kr/logger";

/** A real logger that discards its output, so failure-path tests do not print error lines. */
export const silentLog: Logger = createLogger({
  service: "test",
  env: "local",
  level: "error",
  destination: { write: () => undefined },
});
