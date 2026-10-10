// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startUpstream, type Upstream } from "@/test/upstream";
import { syntheticMe } from "@/test/fixtures";

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(incoming.headers) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

import { getMe, getOptionalMe } from "./get-me";

let upstream: Upstream | undefined;
beforeEach(() => {
  incoming.headers = new Headers({
    cookie: "__Host-kr_session=s",
    authorization: "Bearer evil",
    "x-return-to": "/jobs/1",
  });
});
afterEach(async () => {
  await upstream?.close();
  upstream = undefined;
  vi.unstubAllEnvs();
});

async function api(status: number, body: unknown): Promise<void> {
  upstream = await startUpstream((_req, res) =>
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body)),
  );
  vi.stubEnv("API_INTERNAL_URL", upstream.url);
}

describe("getMe", () => {
  it("returns the parsed Me, calling /v1/me with only the allowlisted cookie headers", async () => {
    const me = syntheticMe("admin");
    await api(200, me);
    await expect(getMe()).resolves.toMatchObject({ user: { role: "admin" }, csrfToken: me.csrfToken });
    expect(upstream?.seen[0]?.url).toBe("/v1/me");
    expect(upstream?.seen[0]?.headers).toMatchObject({ cookie: "__Host-kr_session=s" });
    expect(upstream?.seen[0]?.headers).not.toHaveProperty("authorization");
  });

  it("redirects a 401 to sign-in with the validated returnTo", async () => {
    await api(401, { type: "urn:kr:problem:unauthenticated", title: "x", status: 401, requestId: "r" });
    await expect(getMe()).rejects.toThrow("REDIRECT /sign-in?returnTo=%2Fjobs%2F1");
  });

  it("throws the ApiProblem (with its request id) for other failures, and rejects a body that is not a Me", async () => {
    await api(500, { type: "about:blank", title: "Internal", status: 500, requestId: "req-500" });
    await expect(getMe()).rejects.toMatchObject({ status: 500, requestId: "req-500" });
    await upstream?.close();
    await api(200, { nope: true });
    await expect(getMe()).rejects.toThrow();
  });
});

describe("getOptionalMe", () => {
  it("is the Me for a session and null (not a redirect) when there is none, so a 404 page can still render", async () => {
    await api(200, syntheticMe("staff"));
    await expect(getOptionalMe()).resolves.toMatchObject({ user: { role: "staff" } });
    await upstream?.close();
    await api(401, { type: "urn:kr:problem:unauthenticated", title: "x", status: 401, requestId: "r" });
    await expect(getOptionalMe()).resolves.toBeNull();
  });

  it("still throws for any other failure", async () => {
    await api(500, { type: "about:blank", title: "Internal", status: 500, requestId: "req-500" });
    await expect(getOptionalMe()).rejects.toMatchObject({ status: 500 });
  });
});
