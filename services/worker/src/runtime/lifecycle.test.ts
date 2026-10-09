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

  it("exits 1 and logs when a closer fails", async () => {
    const { shutdown, exit, events } = setup(() => Promise.resolve(true), [() => Promise.reject(new Error("pool"))]);
    await shutdown("SIGTERM");
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(events()).toContain("shutdown_failed");
  });
});

describe("installCrashGuards", () => {
  it("logs fatally and exits 1 on an unhandled rejection or uncaught exception", () => {
    const { log, events } = captureLog();
    const exit = vi.fn<(code: number) => void>();
    const proc = new EventEmitter();
    installCrashGuards(log, exit, proc);
    proc.emit("unhandledRejection", new Error("a"));
    proc.emit("uncaughtException", new Error("b"));
    expect(exit).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledWith(1);
    expect(events()).toEqual(["unhandled_rejection", "uncaught_exception"]);
  });
});

describe("parseOtlpHeaders", () => {
  it("reads key=value pairs and drops malformed ones", () => {
    expect(parseOtlpHeaders("a=1, b = two=2 ,broken,=x")).toEqual({ a: "1", b: "two=2" });
    expect(parseOtlpHeaders(undefined)).toEqual({});
  });
});
