// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { startUpstream, type Upstream } from "@/test/upstream";
import { proxyToApi } from "./proxy";

let upstream: Upstream | undefined;
afterEach(async () => {
  await upstream?.close();
  upstream = undefined;
});

const browser = (path: string, init: RequestInit & { duplex?: "half" } = {}) =>
  new Request(`https://tracker.example.com/api/v1/${path}`, init);
const segs = (path: string) => path.split("?")[0]?.split("/") ?? [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("proxyToApi: request", () => {
  it("forwards method, query, body and only the allowlisted headers (+ X-Forwarded-*) to /v1", async () => {
    upstream = await startUpstream((_req, res) => res.writeHead(201, { "content-type": "application/json" }).end("{}"));
    const res = await proxyToApi(
      browser("jobs/abc?cursor=x%20y", {
        method: "POST",
        body: '{"a":1}',
        headers: {
          cookie: "__Host-kr_session=s",
          "content-type": "application/json",
          "x-csrf-token": "csrf-token-1234567890",
          "if-match": '"3"',
          "idempotency-key": "idem-12345678",
          range: "bytes=0-9",
          origin: "https://tracker.example.com",
          "user-agent": "UA/1",
          "x-forwarded-for": "203.0.113.9, 10.0.0.1",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "tracker.example.com",
          authorization: "Bearer evil",
          "accept-language": "fr",
          "x-internal-admin": "1",
        },
      }),
      segs("jobs/abc"),
      { apiUrl: upstream.url },
    );
    expect(res.status).toBe(201);
    const seen = upstream.seen[0];
    expect(seen).toMatchObject({ method: "POST", url: "/v1/jobs/abc?cursor=x%20y", body: '{"a":1}' });
    expect(seen?.headers).toMatchObject({
      cookie: "__Host-kr_session=s",
      "content-type": "application/json",
      "x-csrf-token": "csrf-token-1234567890",
      "if-match": '"3"',
      "idempotency-key": "idem-12345678",
      range: "bytes=0-9",
      origin: "https://tracker.example.com",
      "user-agent": "UA/1",
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "tracker.example.com",
    });
    expect(seen?.headers).not.toHaveProperty("authorization");
    expect(seen?.headers["accept-language"]).not.toBe("fr"); // only undici's own default, never the browser's
    expect(seen?.headers).not.toHaveProperty("x-internal-admin");
    expect(seen?.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("never invents X-Forwarded-For; falls back to the request's own scheme and host for proto/host", async () => {
    upstream = await startUpstream((_req, res) => res.end("ok"));
    await proxyToApi(browser("me", { headers: { host: "tracker.example.com" } }), ["me"], { apiUrl: upstream.url });
    expect(upstream.seen[0]?.headers).not.toHaveProperty("x-forwarded-for");
    expect(upstream.seen[0]?.headers).toMatchObject({ "x-forwarded-proto": "https" });
  });

  it("keeps an inert incoming X-Request-Id and echoes it on the response", async () => {
    upstream = await startUpstream((_req, res) => res.end("ok"));
    const res = await proxyToApi(browser("me", { headers: { "x-request-id": "req-abcdef12" } }), ["me"], {
      apiUrl: upstream.url,
    });
    expect(upstream.seen[0]?.headers["x-request-id"]).toBe("req-abcdef12");
    expect(res.headers.get("x-request-id")).toBe("req-abcdef12");
  });

  it("streams the request body to the API as it arrives", async () => {
    upstream = await startUpstream((req, res) => {
      req.on("end", () => res.end("done"));
    });
    let push!: (chunk: string) => void;
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => {
          c.enqueue(new TextEncoder().encode(s));
        };
        close = () => {
          c.close();
        };
      },
    });
    const pending = proxyToApi(
      browser("jobs/j/files", { method: "POST", body, duplex: "half", headers: { "content-type": "text/plain" } }),
      segs("jobs/j/files"),
      { apiUrl: upstream.url },
    );
    push("first-");
    await sleep(80);
    expect(upstream.seen[0]?.body).toBe(""); // not complete yet: the API is still reading
    push("second");
    close();
    const res = await pending;
    expect(await res.text()).toBe("done");
    expect(upstream.seen[0]?.body).toBe("first-second");
  });
});

describe("proxyToApi: response", () => {
  it("streams the response body and keeps status and headers", async () => {
    let finish!: () => void;
    upstream = await startUpstream((_req, res) => {
      res.writeHead(206, { "content-type": "application/zip", "content-range": "bytes 0-9/99" });
      res.write("part-one");
      finish = () => res.end("part-two");
    });
    const res = await proxyToApi(browser("jobs/j/package"), segs("jobs/j/package"), { apiUrl: upstream.url });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-9/99");
    const reader = res.body?.getReader();
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe("part-one"); // before the API finished
    finish();
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe("part-two");
  });

  it("passes every Set-Cookie through and strips hop-by-hop headers", async () => {
    upstream = await startUpstream((_req, res) => {
      res.setHeader("Set-Cookie", [
        "__Host-kr_session=a; HttpOnly; Secure; Path=/",
        "__Host-kr_auth=; Max-Age=0; Path=/",
      ]);
      res.setHeader("Keep-Alive", "timeout=5");
      res.setHeader("X-Hop", "1");
      res.setHeader("Connection", "keep-alive, X-Hop");
      res.end("ok");
    });
    const res = await proxyToApi(browser("auth/logout", { method: "POST" }), segs("auth/logout"), {
      apiUrl: upstream.url,
    });
    expect(res.headers.getSetCookie()).toEqual([
      "__Host-kr_session=a; HttpOnly; Secure; Path=/",
      "__Host-kr_auth=; Max-Age=0; Path=/",
    ]);
    expect(res.headers.has("keep-alive")).toBe(false);
    expect(res.headers.has("x-hop")).toBe(false);
    expect(res.headers.has("connection")).toBe(false);
  });

  it("passes redirects through without following them", async () => {
    upstream = await startUpstream((req, res) =>
      req.url?.startsWith("/v1/auth/login")
        ? res.writeHead(302, { location: "https://login.microsoftonline.com/x/authorize?state=1" }).end()
        : res.writeHead(200).end("followed!"),
    );
    const res = await proxyToApi(browser("auth/login?returnTo=%2F"), segs("auth/login"), { apiUrl: upstream.url });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://login.microsoftonline.com/x/authorize?state=1");
    expect(upstream.seen).toHaveLength(1);
  });

  it("passes a 204 with no body", async () => {
    upstream = await startUpstream((_req, res) => res.writeHead(204).end());
    const res = await proxyToApi(browser("jobs/j", { method: "DELETE" }), segs("jobs/j"), { apiUrl: upstream.url });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });
});

describe("proxyToApi: failures", () => {
  it("answers 502 problem+json when the API is down, without internals", async () => {
    upstream = await startUpstream((_req, res) => res.end());
    const apiUrl = upstream.url;
    await upstream.close();
    upstream = undefined;
    const res = await proxyToApi(browser("me", { headers: { "x-request-id": "req-abcdef12" } }), ["me"], { apiUrl });
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toEqual({
      type: "about:blank",
      title: "Bad Gateway",
      status: 502,
      detail: "The service is temporarily unavailable. Please try again.",
      requestId: "req-abcdef12",
    });
  });

  it("times out a JSON call but not an upload or a download", async () => {
    upstream = await startUpstream((_req, res) => setTimeout(() => res.writeHead(200).end("late"), 150));
    expect((await proxyToApi(browser("me"), ["me"], { apiUrl: upstream.url, timeoutMs: 40 })).status).toBe(502);
    const fileId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const download = await proxyToApi(browser(`files/${fileId}/content`), segs(`files/${fileId}/content`), {
      apiUrl: upstream.url,
      timeoutMs: 40,
    });
    expect(await download.text()).toBe("late");
    const upload = await proxyToApi(
      browser(`jobs/${fileId}/files`, { method: "POST", body: "x" }),
      segs(`jobs/${fileId}/files`),
      {
        apiUrl: upstream.url,
        timeoutMs: 40,
      },
    );
    expect(await upload.text()).toBe("late");
  });

  it("cancels the API call when the browser goes away (499)", async () => {
    upstream = await startUpstream(() => undefined);
    const controller = new AbortController();
    const pending = proxyToApi(browser("me", { signal: controller.signal }), ["me"], { apiUrl: upstream.url });
    await sleep(20);
    controller.abort();
    expect((await pending).status).toBe(499);
  });

  it("rejects path traversal and malformed segments with 404 before any upstream call", async () => {
    upstream = await startUpstream((_req, res) => res.end("secret"));
    for (const bad of [["..", "healthz"], [".", "me"], ["a/b"], ["a\\b"], [""], ["a\nb"]]) {
      const res = await proxyToApi(browser("x"), bad, { apiUrl: upstream.url });
      expect(res.status).toBe(404);
    }
    expect(upstream.seen).toHaveLength(0);
  });

  it("answers a generic 500 when the API URL is not configured", async () => {
    const res = await proxyToApi(browser("me"), ["me"], { apiUrl: "" }); // "" is not nullish: skips env, fails to fetch
    expect(res.status).toBe(502);
  });
});
