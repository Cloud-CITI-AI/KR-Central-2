// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startUpstream, type Upstream } from "@/test/upstream";

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(incoming.headers) }));

import { fetchUpstream, UpstreamUnavailable, upstreamProblem } from "./upstream";

const REQUEST_ID = "7d5e2b8c-0f3a-4c52-9a6e-1b4d8c2f6a90";
let upstream: Upstream | undefined;
beforeEach(() => {
  incoming.headers = new Headers({ cookie: "__Host-kr_session=s", "x-request-id": REQUEST_ID });
});
afterEach(async () => {
  await upstream?.close();
  upstream = undefined;
  vi.unstubAllEnvs();
});

describe("fetchUpstream", () => {
  it("sends the proxy's request id to the API and returns it", async () => {
    upstream = await startUpstream((_req, res) => res.writeHead(200).end("{}"));
    vi.stubEnv("API_INTERNAL_URL", upstream.url);
    const { requestId } = await fetchUpstream("/v1/me");
    expect(requestId).toBe(REQUEST_ID);
    expect(upstream.seen[0]?.headers["x-request-id"]).toBe(REQUEST_ID);
  });

  it("fails with the request id as the error's digest when the API cannot be reached, so the 500 page shows an id the logs carry", async () => {
    upstream = await startUpstream((_req, res) => res.writeHead(200).end("{}"));
    vi.stubEnv("API_INTERNAL_URL", upstream.url);
    await upstream.close();
    upstream = undefined;
    const failure = await fetchUpstream("/v1/me").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamUnavailable);
    expect(failure).toMatchObject({ digest: REQUEST_ID, message: "The API could not be reached." });
  });
});

describe("upstreamProblem", () => {
  it("carries the API's request id as the digest, else the request's own", async () => {
    const withId = await upstreamProblem(
      Response.json({ type: "about:blank", title: "Boom", status: 500, requestId: "req-api-0001" }, { status: 500 }),
      REQUEST_ID,
    );
    expect(withId).toMatchObject({ requestId: "req-api-0001", digest: "req-api-0001" });
    const platformPage = await upstreamProblem(new Response("<html>502</html>", { status: 502 }), REQUEST_ID);
    expect(platformPage).toMatchObject({ status: 502, digest: REQUEST_ID });
  });
});
