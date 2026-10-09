#!/usr/bin/env node
/**
 * Post-deploy smoke test of the public web origin (ADR-0008, PRODUCT_SPEC section 14, docs/slo.md).
 *
 *   node smoke.mjs --base-url https://tracker.example.com.au
 *   node smoke.mjs --base-url https://tracker.example.com.au --watch-minutes 10     (repeat every 30 s, fail on any error)
 *
 * Checks per round: GET /api/healthz and /api/readyz answer 200 {"status":"ok"} (the BFF route, NOT /api/v1/readyz);
 * GET /sign-in answers 200 with a per-request nonce CSP (frame-ancestors 'none', the nonce is the one in the HTML), HSTS,
 * nosniff and a strict Referrer-Policy; and a latency probe of --samples sequential GET /api/readyz requests (one warm-up
 * is discarded) whose nearest-rank p95 and p99 stay inside the read budgets (SLO-2: p95 < 300 ms, p99 < 800 ms).
 * Measured from the runner, so network distance counts: raise --p95-ms/--p99-ms only with a recorded reason.
 * Exit codes: 0 all good, 1 a check failed, 2 bad usage. Node 24, no dependencies, no secrets involved.
 */
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const WATCH_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const REFERRER_POLICIES = new Set(["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"]);

class UsageError extends Error {}

export function parseOptions(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        "base-url": { type: "string" },
        "watch-minutes": { type: "string", default: "0" },
        samples: { type: "string", default: "20" },
        "p95-ms": { type: "string", default: "300" },
        "p99-ms": { type: "string", default: "800" },
      },
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  let base;
  try {
    base = new URL(values["base-url"] ?? "");
  } catch {
    throw new UsageError("--base-url must be an absolute http(s) URL");
  }
  if (!/^https?:$/.test(base.protocol)) throw new UsageError("--base-url must be an absolute http(s) URL");
  const num = (name, min) => {
    const n = Number(values[name]);
    if (!(n >= min)) throw new UsageError(`--${name} must be a number >= ${min}`);
    return n;
  };
  return {
    base,
    watchMinutes: num("watch-minutes", 0),
    samples: num("samples", 5),
    p95Ms: num("p95-ms", 1),
    p99Ms: num("p99-ms", 1),
  };
}

/** Nearest-rank percentile of a list of numbers. */
export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** Problems with the response headers of the sign-in page, given its HTML (empty when fine). */
const ONE_YEAR_SECONDS = 31536000;

export function headerProblems(headers, html, { secure }) {
  const problems = [];
  const csp = headers.get("content-security-policy") ?? "";
  const nonce = /script-src[^;]*'nonce-([A-Za-z0-9+/=_-]+)'/.exec(csp)?.[1];
  if (nonce === undefined) problems.push("content-security-policy has no script-src nonce");
  else if (!html.includes(`nonce="${nonce}"`)) problems.push("the CSP nonce is not the one used in the page");
  if (!/(^|;)\s*frame-ancestors 'none'/.test(csp))
    problems.push("content-security-policy lacks frame-ancestors 'none'");
  if (secure) {
    const maxAge = Number(/max-age=(\d+)/.exec(headers.get("strict-transport-security") ?? "")?.[1]);
    if (!(maxAge >= ONE_YEAR_SECONDS)) problems.push("strict-transport-security max-age is missing or under a year");
  }
  if (headers.get("x-content-type-options")?.toLowerCase() !== "nosniff")
    problems.push("x-content-type-options is not nosniff");
  if (!REFERRER_POLICIES.has((headers.get("referrer-policy") ?? "").toLowerCase()))
    problems.push("referrer-policy is missing or too permissive");
  return problems;
}

export async function smokeRound(options, { fetch, now }) {
  const problems = [];
  const get = async (path, init = {}) => {
    const started = now();
    const response = await fetch(new URL(path, options.base), {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...init,
    });
    return { response, ms: now() - started };
  };
  const attempt = async (label, work) => {
    try {
      await work();
    } catch (error) {
      problems.push(`${label}: ${error.message}`);
    }
  };
  const expectOk = async (path) => {
    const { response } = await get(path);
    const body = await response.json().catch(() => undefined);
    if (response.status !== 200 || body?.status !== "ok") {
      throw new Error(`expected 200 {"status":"ok"}, got ${response.status} ${JSON.stringify(body)}`);
    }
  };

  await attempt("GET /api/healthz", () => expectOk("/api/healthz"));
  await attempt("GET /api/readyz", () => expectOk("/api/readyz"));
  await attempt("GET /sign-in", async () => {
    const first = await get("/sign-in");
    if (first.response.status !== 200) throw new Error(`expected 200, got ${first.response.status}`);
    const html = await first.response.text();
    const found = headerProblems(first.response.headers, html, { secure: options.base.protocol === "https:" });
    const second = await get("/sign-in");
    const nonce = (r) => /'nonce-([^']+)'/.exec(r.headers.get("content-security-policy") ?? "")?.[1];
    if (nonce(first.response) !== undefined && nonce(first.response) === nonce(second.response)) {
      found.push("the CSP nonce is the same on two requests");
    }
    await second.response.arrayBuffer();
    if (found.length > 0) throw new Error(found.join("; "));
  });
  await attempt("latency probe of /api/readyz", async () => {
    const times = [];
    for (let i = 0; i <= options.samples; i++) {
      const { response, ms } = await get("/api/readyz");
      await response.arrayBuffer();
      if (response.status !== 200) throw new Error(`sample ${i + 1} answered ${response.status}`);
      if (i > 0) times.push(ms); // the first request pays for DNS and TLS
    }
    const p95 = percentile(times, 95);
    const p99 = percentile(times, 99);
    if (p95 >= options.p95Ms || p99 >= options.p99Ms) {
      throw new Error(
        `p95 ${Math.round(p95)} ms (budget ${options.p95Ms}), p99 ${Math.round(p99)} ms (budget ${options.p99Ms})`,
      );
    }
  });
  return problems;
}

export async function main(argv, deps = {}) {
  const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => performance.now());
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    err(`Usage error: ${error.message}`);
    return 2;
  }
  const clock = deps.clock ?? Date.now;
  const watchUntil = clock() + options.watchMinutes * 60_000;
  for (let round = 1; ; round++) {
    const problems = await smokeRound(options, { fetch: deps.fetch ?? globalThis.fetch, now });
    if (problems.length > 0) {
      for (const problem of problems) err(`FAIL round ${round}: ${problem}`);
      return 1;
    }
    out(`ok round ${round}: health, readiness, sign-in headers and latency within budget`);
    if (clock() + WATCH_INTERVAL_MS > watchUntil) return 0;
    await sleep(WATCH_INTERVAL_MS);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
