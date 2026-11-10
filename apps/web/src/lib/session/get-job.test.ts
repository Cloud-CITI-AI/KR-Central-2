// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startUpstream, type Upstream } from "@/test/upstream";

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(incoming.headers) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

import { getJobDetail, getJobSummary } from "./get-job";

const JOB_ID = "00000000-0000-4000-8000-0000000000a1";
let upstream: Upstream | undefined;
beforeEach(() => {
  incoming.headers = new Headers({ cookie: "__Host-kr_session=s", "x-return-to": `/jobs/${JOB_ID}` });
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

describe("getJobSummary", () => {
  it("returns the job number and address of a job the caller can see, with the session cookie forwarded", async () => {
    await api(200, { id: JOB_ID, jobNumber: "P-0001", address: "1 Synthetic Way, Testville", checkpoints: [] });
    await expect(getJobSummary(JOB_ID)).resolves.toEqual({
      id: JOB_ID,
      jobNumber: "P-0001",
      address: "1 Synthetic Way, Testville",
    });
    expect(upstream?.seen[0]?.url).toBe(`/v1/jobs/${JOB_ID}`);
    expect(upstream?.seen[0]?.headers).toMatchObject({ cookie: "__Host-kr_session=s" });
  });

  it("getJobDetail hands the whole job on for the tracker's first HTML, checking only what the page itself needs", async () => {
    const OTHER = "00000000-0000-4000-8000-0000000000a2";
    const body = { id: OTHER, jobNumber: "P-0002", address: "2 Synthetic Way", checkpoints: [], somethingNewer: 1 };
    await api(200, body);
    await expect(getJobDetail(OTHER)).resolves.toEqual(body);
    await upstream?.close();
    await api(200, { id: OTHER, address: "no number" });
    await expect(getJobDetail("00000000-0000-4000-8000-0000000000a3")).rejects.toThrow();
  });

  it("is null for a job that is missing, archived or not the caller's (the API answers 404 for all three)", async () => {
    await api(404, { type: "urn:kr:problem:not-found", title: "Not found", status: 404, requestId: "r" });
    await expect(getJobSummary(JOB_ID)).resolves.toBeNull();
  });

  it("redirects a signed-out caller to sign-in and throws the problem for any other failure", async () => {
    await api(401, { type: "urn:kr:problem:unauthenticated", title: "x", status: 401, requestId: "r" });
    await expect(getJobSummary(JOB_ID)).rejects.toThrow(`REDIRECT /sign-in?returnTo=%2Fjobs%2F${JOB_ID}`);
    await upstream?.close();
    await api(500, { type: "about:blank", title: "Internal", status: 500, requestId: "req-500" });
    await expect(getJobSummary(JOB_ID)).rejects.toMatchObject({ status: 500, requestId: "req-500" });
  });
});
