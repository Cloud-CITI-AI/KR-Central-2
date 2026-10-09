// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy, signInUrl } from "./proxy";

const call = (path: string, init: { cookie?: string; headers?: Record<string, string> } = {}) =>
  proxy(
    new NextRequest(`http://localhost:3000${path}`, {
      headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
    }),
  );
const SESSION = "__Host-kr_session=abc";
/** Redirect target as origin + path (the redirect must stay on the requesting origin). */
const target = (res: Response) => (res.headers.get("location") ?? "").replace("http://localhost:3000", "");

describe("proxy: sign-in redirect", () => {
  it("redirects an unauthenticated page request to /sign-in with a same-origin returnTo", () => {
    const res = call("/jobs/0f8fad5b?stage=wapc");
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/sign-in?returnTo=%2Fjobs%2F0f8fad5b%3Fstage%3Dwapc");
  });

  it("omits returnTo for the dashboard", () => {
    expect(target(call("/"))).toBe("/sign-in");
  });

  it("drops a returnTo that is not a safe path (open redirect)", () => {
    expect(target(call("//evil.example.com/x"))).toBe("/sign-in");
    expect(target(call(`/${"a".repeat(600)}`))).toBe("/sign-in");
  });

  it("lets the public pages through without a session (no redirect loop)", () => {
    for (const path of ["/sign-in", "/sign-in/", "/sign-in-error?reason=failed", "/signed-out"]) {
      expect(call(path).status).toBe(200);
    }
  });

  it("lets a request with the session cookie through; a different cookie name does not count", () => {
    expect(call("/jobs/1", { cookie: SESSION }).status).toBe(200);
    expect(call("/jobs/1", { cookie: "kr_session=abc" }).status).toBe(307);
  });

  it("builds sign-in URLs", () => {
    expect(signInUrl("/a?b=c")).toBe("/sign-in?returnTo=%2Fa%3Fb%3Dc");
  });
});

describe("proxy: CSP and request headers", () => {
  it("sets a fresh nonce CSP on the response and forwards nonce, CSP, request id and returnTo to the app", () => {
    const a = call("/jobs/1?x=1", { cookie: SESSION });
    const b = call("/", { cookie: SESSION });
    const csp = a.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(a.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(a.headers.get("x-middleware-request-x-return-to")).toBe("/jobs/1?x=1");
    expect(a.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.headers.get("content-security-policy")).not.toBe(csp);
  });

  it("keeps an inert incoming request id and ignores a client-supplied x-return-to", () => {
    const res = call("//x", { cookie: SESSION, headers: { "x-request-id": "req-12345678", "x-return-to": "//evil" } });
    expect(res.headers.get("x-request-id")).toBe("req-12345678");
    expect(res.headers.get("x-middleware-request-x-return-to")).toBeNull();
  });
});

describe("proxy: matcher", () => {
  const rule = config.matcher[0];
  // The source is pinned, and this literal is its regex form (Next compiles `source` with path-to-regexp).
  const source = String.raw`/((?!api/|api$|_next/|.*\.[A-Za-z0-9]+$).*)`;
  const matches = (path: string) => /^\/((?!api\/|api$|_next\/|.*\.[A-Za-z0-9]+$).*)$/.test(path);

  it("pins the matcher source", () => {
    expect(rule?.source).toBe(source);
  });

  it("matches pages", () => {
    for (const path of ["/", "/sign-in", "/jobs/0f8fad5b-d9cb-469f-a165-70867728950e", "/admin/users"]) {
      expect(matches(path)).toBe(true);
    }
  });

  it("excludes /api/*, /_next/* and static files", () => {
    for (const path of [
      "/api/v1/me",
      "/api/healthz",
      "/api",
      "/_next/static/chunks/a.js",
      "/favicon.ico",
      "/brand/x.svg",
    ]) {
      expect(matches(path)).toBe(false);
    }
  });

  it("skips prefetch requests", () => {
    expect(rule?.missing).toEqual([
      { type: "header", key: "next-router-prefetch" },
      { type: "header", key: "purpose", value: "prefetch" },
    ]);
  });
});
