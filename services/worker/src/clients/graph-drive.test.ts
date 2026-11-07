/**
 * The Graph client against the local fake (never a Microsoft host): token caching and refresh, Retry-After, the
 * circuit breaker, folder and upload semantics, and that no Authorization header reaches an upload-session URL.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { startFakeGraph, type FakeGraph } from "../../test/fake-graph.js";
import type { Clock } from "../clock.js";
import { CircuitOpenError } from "./circuit-breaker.js";
import {
  GraphError,
  SIMPLE_UPLOAD_MAX_BYTES,
  createGraphDriveClient,
  sitePathOf,
  type GraphDriveClient,
} from "./graph-drive.js";
import { GraphTokenError, createGraphTokenSource } from "./graph-token.js";

let fake: FakeGraph | undefined;
afterEach(async () => {
  await fake?.stop();
  fake = undefined;
});

const SITE = "https://contoso.sharepoint.com/sites/TeamSurvey";
const never = new AbortController().signal;

interface Harness {
  readonly fake: FakeGraph;
  readonly client: GraphDriveClient;
  readonly graphRequests: string[];
  readonly sleeps: number[];
}

async function harness(o: { timeoutMs?: number } = {}): Promise<Harness> {
  fake = await startFakeGraph();
  const clock: Clock = { now: () => new Date("2026-11-06T00:00:00Z") };
  const graphRequests: string[] = [];
  const sleeps: number[] = [];
  const tokens = createGraphTokenSource({
    authorityHost: fake.authorityHost,
    tenantId: fake.tenantId,
    clientId: fake.appId,
    clientSecret: "a-test-secret-of-sixteen-plus",
    clock,
  });
  const client = createGraphDriveClient({
    baseUrl: fake.baseUrl,
    tokens,
    timeoutMs: o.timeoutMs ?? 5000,
    releaseVersion: "1.2.3",
    metrics: {
      recordTeamsGraphRequest: (statusClass) => {
        graphRequests.push(statusClass);
      },
    },
    clock,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
  });
  return { fake, client, graphRequests, sleeps };
}

const failure = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (e: unknown) => e,
  );

describe("sitePathOf", () => {
  it("turns a site URL into Graph's host:/path form", () => {
    expect(sitePathOf(SITE)).toBe("contoso.sharepoint.com:/sites/TeamSurvey");
    expect(sitePathOf("https://contoso.sharepoint.com/sites/TeamSurvey/")).toBe(
      "contoso.sharepoint.com:/sites/TeamSurvey",
    );
    expect(sitePathOf("https://contoso.sharepoint.com")).toBe("contoso.sharepoint.com:/");
  });
});

describe("the Graph drive client", () => {
  it("resolves a site and its drive with one cached token, the KR user agent and a bearer header", async () => {
    const h = await harness();
    h.fake.addSite(SITE, { displayName: "Team Survey" });
    const site = await h.client.siteByUrl(SITE, never);
    expect(site.displayName).toBe("Team Survey");
    const drive = await h.client.defaultDrive(site.id, never);
    expect(drive.id).toMatch(/^b!drive/);
    expect(h.fake.tokensIssued).toBe(1);
    const graph = h.fake.requests.filter((r) => !r.path.includes("oauth2"));
    expect(graph).toHaveLength(2);
    expect(graph[0]?.headers["user-agent"]).toBe("NONISV|KRSurveys|KRTracker/1.2.3");
    expect(graph[0]?.headers.authorization).toMatch(/^Bearer tok-1-/);
    expect(h.graphRequests).toEqual(["2xx", "2xx"]);
  });

  it("answers null for a missing path and a GraphError with the status and code for a refused write", async () => {
    const h = await harness();
    const s = h.fake.addSite(SITE, { writable: false });
    expect(await h.client.itemByPath(s.driveId, "102. Subdivision Tracker", never)).toBeNull();
    const error = await failure(h.client.createFolder(s.driveId, s.rootId, "102. Subdivision Tracker", never));
    expect(error).toBeInstanceOf(GraphError);
    const g = error as GraphError;
    expect([g.status, g.code, g.kind, g.display]).toEqual([
      403,
      "accessDenied",
      "permission_denied",
      "403 accessDenied",
    ]);
    expect(g.message).not.toContain("TeamSurvey");
    expect(h.graphRequests).toEqual(["4xx", "4xx"]);
  });

  it("creates folders idempotently in the caller's hands: a taken name is a 409 nameAlreadyExists", async () => {
    const h = await harness();
    const s = h.fake.addSite(SITE);
    const folder = await h.client.createFolder(s.driveId, s.rootId, "102. Subdivision Tracker", never);
    expect(folder.isFolder).toBe(true);
    expect(folder.createdByAppId).toBe(h.fake.appId);
    const again = (await failure(
      h.client.createFolder(s.driveId, s.rootId, "102. Subdivision Tracker", never),
    )) as GraphError;
    expect([again.status, again.code, again.kind]).toEqual([409, "nameAlreadyExists", "conflict"]);
    expect((await h.client.itemByPath(s.driveId, "102. Subdivision Tracker", never))?.id).toBe(folder.id);
    expect((await h.client.children(s.driveId, s.rootId, never)).map((c) => c.name)).toEqual([
      "102. Subdivision Tracker",
    ]);
  });

  it("refreshes the token once on a 401 and retries the call", async () => {
    const h = await harness();
    const s = h.fake.addSite(SITE);
    h.fake.expireTokenOnce();
    expect((await h.client.root(s.driveId, never)).id).toBe(s.rootId);
    expect(h.fake.tokensIssued).toBe(2);
    expect(h.graphRequests).toEqual(["4xx", "2xx"]);
  });

  it("honours Retry-After on 429 and 503 within the bound, then fails with the status", async () => {
    const h = await harness();
    const s = h.fake.addSite(SITE);
    h.fake.failNext(2, { status: 429, retryAfter: "2" });
    expect((await h.client.root(s.driveId, never)).id).toBe(s.rootId);
    expect(h.sleeps).toEqual([2000, 2000]);
    expect(h.graphRequests).toEqual(["429", "429", "2xx"]);

    h.sleeps.length = 0;
    h.fake.failNext(4, { status: 503 }); // one attempt plus three retries
    const error = (await failure(h.client.root(s.driveId, never))) as GraphError;
    expect(error.status).toBe(503);
    expect(error.unavailable).toBe(true);
    // three retries with backoff and jitter (random = 0.5 → ×0.75), then give up
    expect(h.sleeps).toEqual([750, 1500, 3000]);

    h.sleeps.length = 0;
    h.fake.failNext(1, { status: 429, retryAfter: "120" });
    expect(((await failure(h.client.root(s.driveId, never))) as GraphError).retryAfterMs).toBe(120_000);
    expect(h.sleeps).toEqual([]);
  });

  it("opens the circuit after repeated outages and fails fast until the cool-down passes", async () => {
    const h = await harness();
    const s = h.fake.addSite(SITE);
    h.fake.failNext(50, { status: 503 });
    await failure(h.client.root(s.driveId, never)); // 4 attempts
    await failure(h.client.root(s.driveId, never)); // 5th failure opens the circuit
    const fast = await failure(h.client.root(s.driveId, never));
    expect(fast).toBeInstanceOf(CircuitOpenError);
    const before = h.fake.requests.length;
    await failure(h.client.root(s.driveId, never));
    expect(h.fake.requests.length).toBe(before);
  });

  it("uploads small files with conflictBehavior=fail and large ones through a session in chunks without a bearer header", async () => {
    const h = await harness();
    const s = h.fake.addSite(SITE);
    const folder = await h.client.createFolder(s.driveId, s.rootId, "02 WAPC Approval", never);
    const small = new Uint8Array([1, 2, 3]);
    const item = await h.client.uploadSmall(s.driveId, folder.id, "plan.pdf", small, never);
    expect(item.size).toBe(3);
    expect(h.fake.itemAt(s.driveId, "02 WAPC Approval/plan.pdf")?.content).toEqual(Buffer.from(small));
    expect(h.fake.requests.at(-1)?.path).toContain("conflictBehavior=fail");
    const dup = (await failure(h.client.uploadSmall(s.driveId, folder.id, "plan.pdf", small, never))) as GraphError;
    expect(dup.status).toBe(409);
    await expect(
      h.client.uploadSmall(s.driveId, folder.id, "big.bin", new Uint8Array(SIMPLE_UPLOAD_MAX_BYTES + 1), never),
    ).rejects.toThrow(RangeError);

    const session = await h.client.createUploadSession(s.driveId, folder.id, "big.bin", never);
    const total = 25;
    const bytes = Buffer.alloc(total, 7);
    const first = await h.client.uploadChunk(session, bytes.subarray(0, 10), 0, total, never);
    expect(first).toBeNull();
    const second = await h.client.uploadChunk(session, bytes.subarray(10, 20), 10, total, never);
    expect(second).toBeNull();
    const done = await h.client.uploadChunk(session, bytes.subarray(20), 20, total, never);
    expect(done?.size).toBe(total);
    expect(h.fake.itemAt(s.driveId, "02 WAPC Approval/big.bin")?.content).toEqual(bytes);
    const chunkRequests = h.fake.requests.filter((r) => r.path.startsWith("/_upload/"));
    expect(chunkRequests).toHaveLength(3);
    for (const r of chunkRequests) expect(r.headers.authorization).toBeUndefined();
    expect(chunkRequests.map((r) => r.headers["content-range"])).toEqual([
      "bytes 0-9/25",
      "bytes 10-19/25",
      "bytes 20-24/25",
    ]);
  });

  it("deletes only the version it was told about, and reports a token refusal without the secret", async () => {
    const h = await harness();
    const s = h.fake.addSite(SITE);
    const folder = await h.client.createFolder(s.driveId, s.rootId, "x", never);
    const stale = (await failure(h.client.deleteItem(s.driveId, folder.id, '"other"', never))) as GraphError;
    expect(stale.status).toBe(412);
    await h.client.deleteItem(s.driveId, folder.id, folder.eTag, never);
    expect(await h.client.item(s.driveId, folder.id, never)).toBeNull();

    const fresh = await harness();
    fresh.fake.refuseTokens(401);
    const error = await failure(fresh.client.root("b!x", never));
    expect(error).toBeInstanceOf(GraphTokenError);
    expect((error as GraphTokenError).code).toBe("invalid_client");
    expect(JSON.stringify(error)).not.toContain("a-test-secret");
    await fresh.fake.stop();
    fake = h.fake;
  });

  it("gives up on an attempt that outlives the timeout and counts it as a network failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const h = await harness({ timeoutMs: 1000 });
      const hanging = createGraphDriveClient({
        baseUrl: h.fake.baseUrl,
        tokens: { token: () => Promise.resolve("tok"), invalidate: () => undefined },
        timeoutMs: 1000,
        releaseVersion: "t",
        metrics: {
          recordTeamsGraphRequest: (c) => {
            h.graphRequests.push(c);
          },
        },
        fetch: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "TimeoutError"));
            });
          }),
        sleep: () => Promise.resolve(),
      });
      const promise = failure(hanging.root("b!x", never));
      await vi.advanceTimersByTimeAsync(5000);
      const error = (await promise) as GraphError;
      expect(error).toBeInstanceOf(GraphError);
      expect(error.status).toBeNull();
      expect(h.graphRequests.filter((c) => c === "network").length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
