import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { captureLog } from "../../test/log.js";
import { createShutdown, installCrashGuards, parseOtlpHeaders } from "./lifecycle.js";

function setup(drain: () => Promise<boolean>, closers: readonly ((order: string[]) => Promise<unknown>)[] = []) {
  const { log, events } = captureLog();
  const exit = vi.fn<(code: number) => void>();
  const order: string[] = [];
  const shutdown = createShutdown({
    drain: (timeoutMs) => {
      order.push(`drain:${timeoutMs}`);
      return drain();
    },
    closers: closers.map((close) => () => close(order)),
    log,
    exit,
  });
  return { shutdown, exit, events, order };
}

describe("createShutdown", () => {
  it("drains for 25 s, closes in order, then exits 0", async () => {
    const closing = (name: string) => (order: string[]) => {
      order.push(name);
      return Promise.resolve();
    };
    const { shutdown, exit, order } = setup(() => Promise.resolve(true), [closing("close-1"), closing("close-2")]);
    await shutdown("SIGTERM");
    expect(order).toEqual(["drain:25000", "close-1", "close-2"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("is idempotent: a second signal does not start a second shutdown", async () => {
    const drain = vi.fn(() => Promise.resolve(true));
    const { shutdown, exit } = setup(drain);
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("exits 1 and still closes the connections when work was abandoned", async () => {
    const close = vi.fn((_order: string[]) => Promise.resolve());
    const { shutdown, exit, events } = setup(() => Promise.resolve(false), [close]);
    await shutdown("SIGTERM");
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(events()).toContain("shutdown_work_abandoned");
  });

  it("exits 1 and logs when a closer fails, with the error's name and frames but not its message", async () => {
    const { log, lines, events } = captureLog();
    const exit = vi.fn<(code: number) => void>();
    const shutdown = createShutdown({
      drain: () => Promise.resolve(true),
      closers: [() => Promise.reject(new Error("pool password=hunter2"))],
      log,
      exit,
    });
    await shutdown("SIGTERM");
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(events()).toContain("shutdown_failed");
    const line = lines.find((l) => l.event === "shutdown_failed");
    expect(line).toMatchObject({ errorName: "Error" });
    expect(line).not.toHaveProperty("err");
    expect(JSON.stringify(lines)).not.toContain("hunter2");
  });
});

describe("installCrashGuards", () => {
  it("logs fatally and exits 1 on an unhandled rejection or uncaught exception", () => {
    const { log, lines, events } = captureLog();
    const exit = vi.fn<(code: number) => void>();
    const proc = new EventEmitter();
    installCrashGuards(log, exit, proc);
    proc.emit("unhandledRejection", new Error("a secret=1"));
    proc.emit("uncaughtException", new Error("b secret=2"));
    proc.emit("unhandledRejection", "a bare string with secret=3");
    expect(exit).toHaveBeenCalledTimes(3);
    expect(exit).toHaveBeenCalledWith(1);
    expect(events()).toEqual(["unhandled_rejection", "uncaught_exception", "unhandled_rejection"]);
    // never the raw error: its message can carry row values, addresses or tokens (A6)
    expect(lines.every((l) => !("err" in l))).toBe(true);
    expect(lines.map((l) => l.errorName)).toEqual(["Error", "Error", "string"]);
    expect(JSON.stringify(lines)).not.toContain("secret");
  });
});

describe("parseOtlpHeaders", () => {
  it("reads key=value pairs and drops malformed ones", () => {
    expect(parseOtlpHeaders("a=1, b = two=2 ,broken,=x")).toEqual({ a: "1", b: "two=2" });
    expect(parseOtlpHeaders(undefined)).toEqual({});
  });
});
