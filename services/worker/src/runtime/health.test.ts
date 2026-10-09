import { afterEach, describe, expect, it } from "vitest";
import { runCheck, startHealthServer, type HealthServer } from "./health.js";

let server: HealthServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(
  probes: Record<string, () => Promise<unknown>>,
  draining = false,
  timeoutMs = 100,
): Promise<string> {
  server = await startHealthServer({ host: "127.0.0.1", port: 0, probes, isDraining: () => draining, timeoutMs });
  return `http://127.0.0.1:${server.port}`;
}

describe("runCheck", () => {
  it("is ok for a probe that resolves, fail for one that rejects or hangs", async () => {
    expect(await runCheck(() => Promise.resolve(1), 50)).toBe("ok");
    expect(await runCheck(() => Promise.reject(new Error("down")), 50)).toBe("fail");
    expect(await runCheck(() => new Promise<never>(() => undefined), 20)).toBe("fail");
  });
});

describe("health server", () => {
  it("answers /healthz without touching any dependency", async () => {
    const base = await start({ database: () => Promise.reject(new Error("down")) });
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers /readyz 200 when every probe passes", async () => {
    const base = await start({ database: () => Promise.resolve(), storage: () => Promise.resolve() });
    const res = await fetch(`${base}/readyz?x=1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", draining: false, checks: { database: "ok", storage: "ok" } });
  });

  it("answers /readyz 503 naming the failing dependency, including a hanging one", async () => {
    const base = await start({ database: () => Promise.resolve(), storage: () => new Promise<never>(() => undefined) });
    const res = await fetch(`${base}/readyz`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "degraded",
      draining: false,
      checks: { database: "ok", storage: "fail" },
    });
  });

  it("answers /readyz 503 while draining even when the dependencies are fine", async () => {
    const base = await start({ database: () => Promise.resolve() }, true);
    const res = await fetch(`${base}/readyz`);
    expect(res.status).toBe(503);
    expect((await res.json()) as { draining: boolean }).toMatchObject({ draining: true });
  });

  it("rejects other methods and unknown paths", async () => {
    const base = await start({});
    expect((await fetch(`${base}/healthz`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    const head = await fetch(`${base}/healthz`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
});
