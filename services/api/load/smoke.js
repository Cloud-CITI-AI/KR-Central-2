// k6 API smoke (PRODUCT_SPEC section 14): reads stay under p95 < 300 ms and p99 < 800 ms at a modest concurrency.
//
// It needs a running stack and a signed-in session, passed as environment variables (k6 exposes them as __ENV):
//   BASE_URL        the API's origin, e.g. http://127.0.0.1:4000 (not the web proxy)
//   SESSION_COOKIE  the value of the `__Host-kr_session` cookie of a staff user (sees every job)
// The Playwright driver apps/web/perf/k6.config.ts starts the e2e stack, signs in through the harness, seeds jobs and runs
// this file with k6 (or the grafana/k6 image when k6 is not installed): see services/api/load/README.md.
import http from "k6/http";
import { check, fail } from "k6";

// k6 puts the process environment on the global `__ENV`.
const ENV = /** @type {{ __ENV: Record<string, string | undefined> }} */ (/** @type {unknown} */ (globalThis)).__ENV;
const BASE_URL = ENV.BASE_URL;
const SESSION_COOKIE = ENV.SESSION_COOKIE;
const SESSION_COOKIE_NAME = "__Host-kr_session";
const VUS = Number(ENV.VUS ?? 10);
const DURATION = ENV.DURATION ?? "30s";

// Every endpoint is a named request so its own p95 and p99 are checked, and so a name that never ran fails the thresholds.
const ENDPOINTS = ["list_jobs", "list_picker", "get_job", "job_facets"];
/** @type {Record<string, string[]>} */
const thresholds = {
  http_req_failed: ["rate<0.01"],
  checks: ["rate>0.99"],
};
for (const name of ENDPOINTS) {
  thresholds[`http_req_duration{name:${name}}`] = ["p(95)<300", "p(99)<800"];
  thresholds[`http_reqs{name:${name}}`] = ["count>20"];
}

export const options = { scenarios: { reads: { executor: "constant-vus", vus: VUS, duration: DURATION } }, thresholds };

/** @param {string} name */
function params(name) {
  return {
    headers: { accept: "application/json", cookie: `${SESSION_COOKIE_NAME}=${SESSION_COOKIE}` },
    tags: { name },
  };
}

/** @returns {{ jobIds: string[] }} */
export function setup() {
  if (!BASE_URL || !SESSION_COOKIE) {
    fail(
      "BASE_URL and SESSION_COOKIE are required. Run `pnpm --filter @kr/web exec playwright test -c perf/k6.config.ts` " +
        "(starts the e2e stack and signs in), or see services/api/load/README.md.",
    );
  }
  const response = http.get(`${BASE_URL}/v1/jobs?status=all&limit=50`, params("setup"));
  if (response.status !== 200)
    fail(`GET /v1/jobs answered ${response.status}: is SESSION_COOKIE a live staff session?`);
  /** @type {{ id: string }[]} */
  const jobs = /** @type {{ id: string }[]} */ (response.json("items"));
  const jobIds = jobs.map((job) => job.id);
  if (jobIds.length === 0) fail("The stack has no jobs: seed some before the smoke (the driver seeds 2,000).");
  return { jobIds };
}

/** @param {{ jobIds: string[] }} data */
export default function (data) {
  const jobId = data.jobIds[Math.floor(Math.random() * data.jobIds.length)];
  const list = http.get(`${BASE_URL}/v1/jobs?status=in_progress&limit=50`, params("list_jobs"));
  check(list, { "list jobs is 200": (r) => r.status === 200 });
  // The tracker's job picker: natural job-number order, the largest page, every job.
  const picker = http.get(`${BASE_URL}/v1/jobs?status=all&sort=job_number&limit=100`, params("list_picker"));
  check(picker, { "picker list is 200": (r) => r.status === 200 });
  const job = http.get(`${BASE_URL}/v1/jobs/${jobId}`, params("get_job"));
  check(job, {
    "get job is 200": (r) => r.status === 200,
    "job has its checkpoints": (r) => /** @type {unknown[]} */ (r.json("checkpoints")).length > 0,
  });
  const facets = http.get(`${BASE_URL}/v1/jobs/facets?status=in_progress`, params("job_facets"));
  check(facets, { "facets is 200": (r) => r.status === 200 });
}
