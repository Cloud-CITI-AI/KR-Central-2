import { describe, expect, it } from "vitest";
import { buildDownstreamHeaders, buildUpstreamHeaders } from "./headers";

describe("buildUpstreamHeaders", () => {
  it("keeps X-Forwarded-For exactly as received and never adds one", () => {
    const withIp = buildUpstreamHeaders(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), "req-1", "https:");
    expect(withIp.get("x-forwarded-for")).toBe("203.0.113.9, 10.0.0.1");
    expect(buildUpstreamHeaders(new Headers(), "req-1", "https:").has("x-forwarded-for")).toBe(false);
  });

  it("falls back to the request scheme and Host for proto and host, and pins identity encoding", () => {
    const out = buildUpstreamHeaders(new Headers({ host: "tracker.example.com" }), "req-1", "https:");
    expect(out.get("x-forwarded-proto")).toBe("https");
    expect(out.get("x-forwarded-host")).toBe("tracker.example.com");
    expect(out.get("accept-encoding")).toBe("identity");
    expect(out.get("x-request-id")).toBe("req-1");
  });

  it("drops everything outside the allowlist, including Authorization and a client-supplied Host", () => {
    const out = buildUpstreamHeaders(
      new Headers({ authorization: "Bearer x", "x-evil": "1", cookie: "a=b", "x-csrf-token": "t" }),
      "req-1",
      "http:",
    );
    expect([...out.keys()].sort()).toEqual(
      ["accept-encoding", "cookie", "x-csrf-token", "x-forwarded-proto", "x-request-id"].sort(),
    );
  });
});

describe("buildDownstreamHeaders", () => {
  it("preserves several Set-Cookie headers and strips hop-by-hop and Connection-named headers", () => {
    const upstream = new Headers({ connection: "close, x-hop", "x-hop": "1", "keep-alive": "5", "x-keep": "yes" });
    upstream.append("set-cookie", "a=1; Path=/");
    upstream.append("set-cookie", "b=2; Path=/");
    const out = buildDownstreamHeaders(upstream, "req-1");
    expect(out.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect([...out.keys()].filter((k) => k !== "set-cookie").sort()).toEqual(["x-keep", "x-request-id"]);
  });

  it("drops length and encoding when the HTTP client decoded the body, and keeps the API's request id", () => {
    const out = buildDownstreamHeaders(
      new Headers({ "content-encoding": "gzip", "content-length": "10", "x-request-id": "from-api" }),
      "req-1",
    );
    expect(out.has("content-length") || out.has("content-encoding")).toBe(false);
    expect(out.get("x-request-id")).toBe("from-api");
    expect(buildDownstreamHeaders(new Headers({ "content-length": "10" }), "req-1").get("content-length")).toBe("10");
  });
});
