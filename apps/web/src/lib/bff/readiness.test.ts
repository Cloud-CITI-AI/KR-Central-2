// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkReadiness } from "./readiness";

let server: Server | undefined;
afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

async function upstream(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("checkReadiness", () => {
  it("is ok when the API answers 200 on /readyz", async () => {
    const apiUrl = await upstream((req, res) => res.writeHead(req.url === "/readyz" ? 200 : 404).end("{}"));
    expect(await checkReadiness({ apiUrl })).toBe("ok");
  });

  it("is degraded for 503, redirects, an unreachable API and a timeout", async () => {
    expect(await checkReadiness({ apiUrl: await upstream((_req, res) => res.writeHead(503).end()) })).toBe("degraded");
    expect(
      await checkReadiness({ apiUrl: await upstream((_req, res) => res.writeHead(302, { location: "/x" }).end()) }),
    ).toBe("degraded");
    const down = await upstream((_req, res) => res.end());
    server?.close();
    expect(await checkReadiness({ apiUrl: down })).toBe("degraded");
    expect(await checkReadiness({ apiUrl: await upstream(() => undefined), timeoutMs: 50 })).toBe("degraded");
  });
});
