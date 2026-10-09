// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
  vi.unstubAllEnvs();
});

async function apiAnswering(status: number): Promise<void> {
  server = createServer((_req, res) =>
    res.writeHead(status, { "content-type": "application/json" }).end('{"checks":{}}'),
  );
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("API_INTERNAL_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
}

describe("GET /api/readyz", () => {
  it("mirrors a ready API as 200 and returns only {status}", async () => {
    await apiAnswering(200);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("mirrors a not-ready API as 503", async () => {
    await apiAnswering(503);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded" });
  });

  it("is 503 when the API cannot be reached or the configuration is invalid", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:1");
    expect((await GET()).status).toBe(503);
    vi.stubEnv("API_INTERNAL_URL", "");
    expect((await GET()).status).toBe(503);
  });
});
