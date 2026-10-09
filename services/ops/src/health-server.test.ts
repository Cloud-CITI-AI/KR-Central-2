import { afterEach, describe, expect, it } from "vitest";
import { startHealthServer, type HealthServer, type MigrateStatus } from "./health-server.js";

let server: HealthServer | undefined;
let status: MigrateStatus = "migrating";

async function start(): Promise<string> {
  server = await startHealthServer({ host: "127.0.0.1", port: 0, release: "v9", getStatus: () => status });
  return `http://127.0.0.1:${server.port}`;
}

afterEach(async () => {
  await server?.close();
  server = undefined;
  status = "migrating";
});

describe("migrate health server", () => {
  it("answers 503 while migrations run", async () => {
    const res = await fetch(`${await start()}/healthz`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "migrating", release: "v9" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 200 only once the status is ready", async () => {
    const base = await start();
    status = "ready";
    const res = await fetch(`${base}/healthz?probe=1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready", release: "v9" });
  });

  it("keeps answering 503 after a failure", async () => {
    const base = await start();
    status = "failed";
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "failed" });
  });

  it("answers HEAD with the status and no body", async () => {
    const base = await start();
    status = "ready";
    const res = await fetch(`${base}/healthz`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("rejects other methods and other paths", async () => {
    const base = await start();
    status = "ready";
    const post = await fetch(`${base}/healthz`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/readyz`)).status).toBe(404);
  });

  it("fails to start when the port is taken", async () => {
    await start();
    await expect(
      startHealthServer({ host: "127.0.0.1", port: server?.port ?? 0, release: "v9", getStatus: () => status }),
    ).rejects.toThrow(/EADDRINUSE/);
  });
});
