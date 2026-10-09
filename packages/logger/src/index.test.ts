import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, pseudonymise, requestLogger } from "./index.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      cb();
    },
  });
  return { lines, destination };
}

describe("logger", () => {
  it("writes JSON with service, env, level label and request context", () => {
    const { lines, destination } = capture();
    const log = requestLogger(createLogger({ service: "kr-api", env: "test", destination }), {
      requestId: "r1",
      traceId: "t1",
    });
    log.info({ event: "job.created", jobId: "j1" }, "Job created");
    expect(lines[0]).toMatchObject({
      service: "kr-api",
      env: "test",
      level: "info",
      requestId: "r1",
      traceId: "t1",
      event: "job.created",
      msg: "Job created",
    });
  });

  it("redacts secrets and personal data (LG-3)", () => {
    const { lines, destination } = capture();
    createLogger({ service: "s", env: "test", destination }).info({
      email: "a@b.c",
      user: { email: "x@y.z", token: "abc" },
      req: { headers: { cookie: "s=1" } },
    });
    const line = JSON.stringify(lines[0]);
    expect(line).not.toContain("a@b.c");
    expect(line).not.toContain("x@y.z");
    expect(line).not.toContain("abc");
    expect(line).not.toContain("s=1");
  });

  it("pseudonymises stably and case-insensitively", () => {
    expect(pseudonymise("A@B.c", "salt")).toBe(pseudonymise("a@b.c", "salt"));
    expect(pseudonymise("a@b.c", "salt")).not.toBe(pseudonymise("a@b.c", "other"));
  });
});
