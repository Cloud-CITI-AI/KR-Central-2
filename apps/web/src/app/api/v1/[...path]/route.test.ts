// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { startUpstream, type Upstream } from "@/test/upstream";
import { DELETE, GET, PATCH, POST, PUT } from "./route";

let upstream: Upstream | undefined;
afterEach(async () => {
  await upstream?.close();
  upstream = undefined;
  vi.unstubAllEnvs();
});

describe("/api/v1/[...path]", () => {
  it("proxies every method to ${API_INTERNAL_URL}/v1/<path>", async () => {
    upstream = await startUpstream((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end("{}"));
    vi.stubEnv("API_INTERNAL_URL", upstream.url);
    const call = (handler: typeof GET, method: string) =>
      handler(new Request("https://t.example.com/api/v1/jobs/1/notes", { method }), {
        params: Promise.resolve({ path: ["jobs", "1", "notes"] }),
      });
    for (const [handler, method] of [
      [GET, "GET"],
      [POST, "POST"],
      [PUT, "PUT"],
      [PATCH, "PATCH"],
      [DELETE, "DELETE"],
    ] as const) {
      expect((await call(handler, method)).status).toBe(200);
    }
    expect(upstream.seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET /v1/jobs/1/notes",
      "POST /v1/jobs/1/notes",
      "PUT /v1/jobs/1/notes",
      "PATCH /v1/jobs/1/notes",
      "DELETE /v1/jobs/1/notes",
    ]);
  });

  it("answers a generic 500 problem when the environment is invalid", async () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    const res = await GET(new Request("https://t.example.com/api/v1/me"), {
      params: Promise.resolve({ path: ["me"] }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ title: "Internal Server Error", status: 500 });
  });
});
