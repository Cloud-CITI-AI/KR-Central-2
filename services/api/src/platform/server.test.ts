import { EventEmitter } from "node:events";
import type { Logger } from "@kr/logger";
import { describe, expect, it, vi } from "vitest";
import { createShutdown, installCrashGuards, parseOtlpHeaders } from "./server.js";

const log = { info: vi.fn(), error: vi.fn(), fatal: vi.fn() } as unknown as Logger;

describe("createShutdown", () => {
  it("closes the app, then resources, then telemetry, exits 0 and runs once", async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const shutdown = createShutdown({
      app: { close: () => Promise.resolve(void order.push("app")) },
      closers: [() => Promise.resolve(void order.push("db"))],
      telemetry: { shutdown: () => Promise.resolve(void order.push("telemetry")) },
      log,
      exit,
    });
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    expect(order).toEqual(["app", "db", "telemetry"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("exits 1 when closing fails", async () => {
    const exit = vi.fn();
    await createShutdown({
      app: { close: () => Promise.reject(new Error("boom")) },
      closers: [],
      telemetry: { shutdown: () => Promise.resolve() },
      log,
      exit,
    })("SIGTERM");
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("exits 1 when draining exceeds the deadline (25 s by default)", async () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      void createShutdown({
        app: { close: () => new Promise(() => undefined) },
        closers: [],
        telemetry: { shutdown: () => Promise.resolve() },
        log,
        exit,
      })("SIGTERM");
      await vi.advanceTimersByTimeAsync(24_999);
      expect(exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("installCrashGuards", () => {
  it("logs and exits 1 on unhandledRejection and uncaughtException", () => {
    const proc = new EventEmitter();
    const exit = vi.fn();
    installCrashGuards(log, exit, proc);
    proc.emit("unhandledRejection", new Error("x"));
    proc.emit("uncaughtException", new Error("y"));
    expect(exit).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("parseOtlpHeaders", () => {
  it("parses pairs and drops malformed ones", () => {
    expect(parseOtlpHeaders("authorization=Bearer a=b, x-team = kr ,bad,=nokey")).toEqual({
      authorization: "Bearer a=b",
      "x-team": "kr",
    });
    expect(parseOtlpHeaders(undefined)).toEqual({});
  });
});
