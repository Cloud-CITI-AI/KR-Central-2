import { describe, expect, it, vi } from "vitest";
import { CircuitOpenError, createCircuitBreaker, type CircuitState } from "./circuit-breaker.js";

class Down extends Error {}
class Cancelled extends Error {}

function setup(threshold = 3, coolDownMs = 1000) {
  let now = new Date("2026-10-09T08:00:00.000Z");
  const changes: string[] = [];
  const breaker = createCircuitBreaker({
    name: "dep",
    failureThreshold: threshold,
    coolDownMs,
    isFailure: (e) => e instanceof Down,
    isCancel: (e) => e instanceof Cancelled,
    clock: { now: () => now },
    onStateChange: ({ from, to }) => changes.push(`${from}>${to}`),
  });
  return {
    breaker,
    changes,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}
const down = () => Promise.reject(new Down("down"));
const ok = () => Promise.resolve("ok");
const state = (b: { breaker: { state: CircuitState } }) => b.breaker.state;

describe("the circuit breaker", () => {
  it("stays closed below the threshold and counts only consecutive failures", async () => {
    const s = setup();
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    expect(await s.breaker.run(ok)).toBe("ok");
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    expect(state(s)).toBe("closed");
    expect(s.changes).toEqual([]);
  });

  it("opens after the threshold and then fails fast without calling the dependency", async () => {
    const s = setup();
    for (let i = 0; i < 3; i += 1) await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    expect(state(s)).toBe("open");
    const call = vi.fn(ok);
    await expect(s.breaker.run(call)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(call).not.toHaveBeenCalled();
    s.advance(999);
    await expect(s.breaker.run(call)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(s.changes).toEqual(["closed>open"]);
  });

  it("lets one trial call through after the cool-down and closes on its success", async () => {
    const s = setup();
    for (let i = 0; i < 3; i += 1) await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    s.advance(1000);
    expect(await s.breaker.run(ok)).toBe("ok");
    expect(state(s)).toBe("closed");
    expect(s.changes).toEqual(["closed>open", "open>half_open", "half_open>closed"]);
    // the failure count started again from zero
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    expect(state(s)).toBe("closed");
  });

  it("opens again for a full cool-down when the trial call fails", async () => {
    const s = setup();
    for (let i = 0; i < 3; i += 1) await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    s.advance(1000);
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    expect(state(s)).toBe("open");
    s.advance(999);
    await expect(s.breaker.run(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    s.advance(1);
    expect(await s.breaker.run(ok)).toBe("ok");
  });

  it("allows only one trial call at a time while half-open", async () => {
    const s = setup();
    for (let i = 0; i < 3; i += 1) await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    s.advance(1000);
    let release: () => void = () => undefined;
    const trial = s.breaker.run(
      () =>
        new Promise<string>((resolve) => {
          release = () => {
            resolve("ok");
          };
        }),
    );
    await expect(s.breaker.run(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    release();
    expect(await trial).toBe("ok");
    expect(state(s)).toBe("closed");
  });

  it("treats an error that is not a down dependency as an answer: it resets the count and rethrows", async () => {
    const s = setup();
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    await expect(s.breaker.run(() => Promise.reject(new Error("bad request")))).rejects.toThrow("bad request");
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    expect(state(s)).toBe("closed");
  });

  it("ignores a cancelled call, and a cancelled trial leaves the next call as the trial", async () => {
    const s = setup();
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    await expect(s.breaker.run(() => Promise.reject(new Cancelled("stop")))).rejects.toBeInstanceOf(Cancelled);
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    expect(state(s)).toBe("open");
    s.advance(1000);
    await expect(s.breaker.run(() => Promise.reject(new Cancelled("stop")))).rejects.toBeInstanceOf(Cancelled);
    expect(state(s)).toBe("half_open");
    expect(await s.breaker.run(ok)).toBe("ok");
    expect(state(s)).toBe("closed");
  });

  it("names the dependency in the open error", async () => {
    const s = setup(1);
    await expect(s.breaker.run(down)).rejects.toBeInstanceOf(Down);
    await expect(s.breaker.run(ok)).rejects.toMatchObject({ name: "CircuitOpenError", dependency: "dep" });
  });
});
