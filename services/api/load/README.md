# k6 API smoke (WP-22)

`smoke.js` holds PRODUCT_SPEC section 14 for API reads: **p95 < 300 ms and p99 < 800 ms** for `GET /v1/jobs`,
`GET /v1/jobs/{jobId}` and `GET /v1/jobs/facets`, each judged on its own, with `http_req_failed < 1 %`, checks above 99 %
and at least 20 requests per endpoint (so an endpoint that never ran cannot pass). Default load: 10 virtual users for 30 s
(`VUS`, `DURATION`); the spec's design point is 50 concurrent users.

## Run it against the e2e stack (what CI runs)

```sh
pnpm build
pnpm --filter @kr/web exec playwright test -c perf/k6.config.ts
```

The driver `apps/web/perf/k6-smoke.spec.ts` starts the WP-19 stack (Postgres, S3 mock, mock Entra, API, worker, web), signs in
as staff through the real OIDC flow, seeds 24 synthetic jobs and runs `smoke.js` against the API with the session cookie.
It uses `k6` when installed, else `docker run --network host mirror.gcr.io/grafana/k6` (override with `K6_IMAGE`).

## Run it against any stack

`pnpm --filter @kr/api test:load` runs `k6 run load/smoke.js` and needs `k6` on the PATH plus two variables:

```sh
BASE_URL=http://127.0.0.1:<api port> SESSION_COOKIE=<value of __Host-kr_session for a staff user> pnpm --filter @kr/api test:load
# without k6 installed:
docker run --rm --network host -v "$PWD/services/api/load:/load:ro" -e BASE_URL -e SESSION_COOKIE \
  mirror.gcr.io/grafana/k6:2.3.0 run /load/smoke.js
```

Point it at a local or e2e stack only: never at production (X3). A threshold breach exits 99.
