import assert from "node:assert/strict";
import { test } from "node:test";
import { headerProblems, main, parseOptions, percentile } from "../scripts/smoke.mjs";

const BASE = "https://tracker.example.test";
let counter = 0;

/** A fake web origin whose routes, headers and latency can be overridden; time is a fake clock. */
function site({ latency = () => 50, ready = 200, health = 200, headers = {}, html, calls = [] } = {}) {
  let clock = 0;
  const secure = () => {
    const nonce = Buffer.from(`nonce-${counter++}`).toString("base64");
    return {
      nonce,
      headers: {
        "content-security-policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; frame-ancestors 'none'`,
        "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        ...headers,
      },
    };
  };
  const fetch = async (url) => {
    const { pathname } = new URL(url);
    calls.push(pathname);
    clock += pathname === "/api/readyz" ? latency(calls.length) : 5;
    const json = (status) => Response.json({ status: status === 200 ? "ok" : "degraded" }, { status });
    if (pathname === "/api/healthz") return json(health);
    if (pathname === "/api/readyz") return json(ready);
    if (pathname === "/sign-in") {
      const { nonce, headers: h } = secure();
      const entries = Object.entries(h).filter(([, v]) => v !== null);
      return new Response(html ?? `<script nonce="${nonce}"></script>`, {
        status: 200,
        headers: Object.fromEntries(entries),
      });
    }
    return new Response("", { status: 404 });
  };
  return { fetch, now: () => clock, calls, advance: (ms) => (clock += ms) };
}

async function smoke(origin, args = []) {
  const out = [];
  const errors = [];
  let wall = 0;
  const code = await main(["--base-url", BASE, ...args], {
    fetch: origin.fetch,
    now: origin.now,
    clock: () => wall,
    sleep: async (ms) => void (wall += ms),
    out: (line) => out.push(line),
    err: (line) => errors.push(line),
  });
  return { code, out, errors, wall };
}

test("a healthy site passes: health, readiness (the BFF route), sign-in headers and the latency probe", async () => {
  const origin = site();
  const { code, out, errors } = await smoke(origin);
  assert.deepEqual(errors, []);
  assert.equal(code, 0);
  assert.equal(out.length, 1);
  assert.ok(origin.calls.includes("/api/healthz") && origin.calls.includes("/api/readyz"));
  assert.ok(!origin.calls.some((path) => path.includes("/v1/")), "never /api/v1/readyz");
  assert.equal(
    origin.calls.filter((p) => p === "/api/readyz").length,
    1 + 1 + 20,
    "readiness check plus warm-up plus 20 samples",
  );
});

test("a failing health or readiness route fails the run and names the route", async () => {
  const unhealthy = await smoke(site({ health: 503 }));
  assert.equal(unhealthy.code, 1);
  assert.match(unhealthy.errors.join("\n"), /GET \/api\/healthz: expected 200 .* got 503/);
  const notReady = await smoke(site({ ready: 503 }));
  assert.equal(notReady.code, 1);
  assert.match(notReady.errors.join("\n"), /GET \/api\/readyz: expected 200/);
});

test("each missing or weak security header is reported", async () => {
  const cases = [
    [{ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" }, /no script-src nonce/],
    [
      { "content-security-policy": "script-src 'nonce-AAAA'; frame-ancestors 'none'" },
      /nonce is not the one used in the page/,
    ],
    [{ "content-security-policy": "script-src 'nonce-AAAA'" }, /frame-ancestors/],
    [{ "strict-transport-security": null }, /strict-transport-security/],
    [{ "strict-transport-security": "max-age=60" }, /strict-transport-security/],
    [{ "strict-transport-security": "max-age=10000000" }, /strict-transport-security/], // about 116 days
    [{ "strict-transport-security": "max-age=31535999" }, /strict-transport-security/],
    [{ "x-content-type-options": null }, /nosniff/],
    [{ "referrer-policy": "unsafe-url" }, /referrer-policy/],
  ];
  for (const [headers, pattern] of cases) {
    const { code, errors } = await smoke(site({ headers, html: '<script nonce="BBBB"></script>' }));
    assert.equal(code, 1, JSON.stringify(headers));
    assert.match(errors.join("\n"), pattern);
  }
});

test("a nonce that repeats between requests is reported", async () => {
  const fixed = "script-src 'nonce-AAAA'; frame-ancestors 'none'";
  const { code, errors } = await smoke(
    site({ headers: { "content-security-policy": fixed }, html: '<script nonce="AAAA"></script>' }),
  );
  assert.equal(code, 1);
  assert.match(errors.join("\n"), /same on two requests/);
});

test("HSTS max-age of exactly one year or more is accepted", () => {
  for (const value of ["max-age=31536000", "max-age=63072000; includeSubDomains; preload"]) {
    const headers = new Headers({
      "content-security-policy": "script-src 'nonce-AAAA'; frame-ancestors 'none'",
      "strict-transport-security": value,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    assert.deepEqual(headerProblems(headers, 'nonce="AAAA"', { secure: true }), [], value);
  }
});

test("HSTS is only required over https", () => {
  const headers = new Headers({
    "content-security-policy": "script-src 'nonce-AAAA'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  assert.deepEqual(headerProblems(headers, 'nonce="AAAA"', { secure: false }), []);
  assert.equal(headerProblems(headers, 'nonce="AAAA"', { secure: true }).length, 1);
});

test("the latency probe fails when p95 or p99 exceeds the read budget", async () => {
  const slow = await smoke(site({ latency: () => 400 }));
  assert.equal(slow.code, 1);
  assert.match(slow.errors.join("\n"), /latency probe .* p95 400 ms \(budget 300\)/);
  // one spike of 900 ms in 20 samples: p95 stays inside, p99 (the maximum of 20) breaches 800 ms
  const spike = await smoke(site({ latency: (n) => (n === 20 ? 900 : 50) }));
  assert.equal(spike.code, 1);
  assert.match(spike.errors.join("\n"), /p99 900 ms \(budget 800\)/);
  assert.equal((await smoke(site({ latency: () => 400 }), ["--p95-ms", "500"])).code, 0);
});

test("--watch-minutes repeats every 30 seconds and passes when every round is clean", async () => {
  const { code, out, wall } = await smoke(site(), ["--watch-minutes", "10"]);
  assert.equal(code, 0);
  assert.equal(out.length, 21, "rounds at 0, 30, ..., 600 seconds");
  assert.equal(wall, 600_000);
});

test("--watch-minutes fails on the first round with an error or budget breach and stops watching", async () => {
  const origin = site();
  const original = origin.fetch;
  let round = 0;
  const flaky = {
    ...origin,
    fetch: async (url) => {
      if (new URL(url).pathname === "/api/healthz" && ++round === 4) return Response.json({}, { status: 502 });
      return original(url);
    },
  };
  const { code, out, errors, wall } = await smoke(flaky, ["--watch-minutes", "10"]);
  assert.equal(code, 1);
  assert.equal(out.length, 3);
  assert.match(errors.join("\n"), /FAIL round 4: GET \/api\/healthz/);
  assert.equal(wall, 90_000);

  const slowLater = site({ latency: (n) => (n > 100 ? 500 : 50) });
  const breach = await smoke(slowLater, ["--watch-minutes", "10"]);
  assert.equal(breach.code, 1);
  assert.match(breach.errors.join("\n"), /p95 500 ms/);
});

test("a network error is a failed check, not a crash", async () => {
  const origin = { ...site(), fetch: async () => Promise.reject(new TypeError("fetch failed")) };
  const { code, errors } = await smoke(origin);
  assert.equal(code, 1);
  assert.match(errors.join("\n"), /GET \/api\/healthz: fetch failed/);
});

test("usage errors exit 2 without any request", async () => {
  const origin = site();
  for (const args of [
    [],
    ["--base-url", "nonsense"],
    ["--base-url", "ftp://x.test"],
    ["--base-url", BASE, "--samples", "2"],
    ["--bogus"],
  ]) {
    const out = [];
    const errors = [];
    const code = await main(args, { fetch: origin.fetch, out: (l) => out.push(l), err: (l) => errors.push(l) });
    assert.equal(code, 2, args.join(" "));
    assert.match(errors.join(), /Usage error/);
  }
  assert.equal(origin.calls.length, 0);
});

test("parseOptions and percentile follow the documented defaults", () => {
  const o = parseOptions(["--base-url", BASE]);
  assert.deepEqual([o.samples, o.p95Ms, o.p99Ms, o.watchMinutes], [20, 300, 800, 0]);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([5, 1, 3], 50), 3);
});
