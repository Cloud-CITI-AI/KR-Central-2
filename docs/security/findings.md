# Security findings from the WP-20 suite

Defects the security tests in `services/api/test/security/` found in code outside WP-20's owned paths. Per the brief,
the suite commits only passing tests: each defect below carries the failing test that reproduces it (run with
`pnpm --filter @kr/api exec vitest run --project integration <file>` after pasting it into
`services/api/test/security/defects.int.test.ts`; the output shown was recorded on the commit that added this file).
Fixing them belongs to the owning module, with the test moved into the suite in the same change.

| ID  | Severity | Area                                                       | Summary                                                                                     | Owner path                                                                |
| --- | -------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| D-1 | Low      | `services/api/src/platform/rate-limit.ts`                  | The per-IP sign-in limit keys on the raw rightmost `X-Forwarded-For` entry, valid or not    | `/services/api/src/platform/**` (security CODEOWNER)                      |
| D-2 | Low      | `services/api/src/app.ts` (Fastify options)                | A path parameter over 100 characters is answered by Fastify's own 414, outside the platform | `/services/api/src/**` (security CODEOWNER)                               |
| D-3 | Low      | `apps/web/src/proxy.ts` matcher, `apps/web/next.config.ts` | Framework 404 pages for paths ending in a file extension, `/api` and `/api/v1` carry no CSP | `/apps/web/src/proxy.ts`, `/apps/web/next.config.ts` (security CODEOWNER) |

## D-1: the sign-in rate-limit key is whatever text the trusted hop sent

**What happens.** With `TRUST_PROXY_HOPS=1` the API takes `request.ip` from the rightmost `X-Forwarded-For` entry and
`limitFor` uses it unchanged as the bucket (`signIn:<ip>`). Nothing checks that it is an address. Observed keys, from
`GET /v1/auth/callback` with the header on the left and the bucket created on the right:

| `X-Forwarded-For` | Bucket                                                      |
| ----------------- | ----------------------------------------------------------- |
| `not-an-ip`       | `signIn:not-an-ip`                                          |
| `<script>`        | `signIn:<script>`                                           |
| `999.999.999.999` | `signIn:999.999.999.999`                                    |
| `1.2.3.4:80, x`   | `signIn:x`                                                  |
| `[::1]:80`        | `signIn:[::1]:80`                                           |
| `::ffff:1.2.3.4`  | `signIn:::ffff:1.2.3.4` (a different bucket from `1.2.3.4`) |

**Impact.** In production the rightmost entry is set by the Railway edge, so a client cannot choose it and the limit
holds (the suite proves that spoofed prefixes do not mint buckets: `client-ip.int.test.ts`). The gap is defence in
depth. If the edge ever forwards a client-supplied rightmost value (a platform change, a mis-set hop count, or
`TRUST_PROXY_HOPS=1` in an environment with no edge in front, as in preview or local stacks), a client can choose its
own bucket per request and bypass the 20 per minute limit, which also lets it flood `auth_flows`. Keys that are not
addresses also reach the `rate_limits` table, whose rows are logged by operators.

**Suggested fix.** In `limitFor`, use `request.ip` only when `net.isIP(request.ip) !== 0`, normalising IPv4-mapped IPv6
(`::ffff:a.b.c.d` to `a.b.c.d`); otherwise charge the peer's own address (`request.socket.remoteAddress`), which is the
shared BFF bucket, so garbage cannot spread over many buckets or lock out real clients.

**Failing test.**

```ts
it("D-1: a rightmost X-Forwarded-For entry that is not an IP address does not become a rate-limit key", async () => {
  const remote = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  for (const xff of ["not-an-ip", "<script>", "999.999.999.999", "unknown"])
    await t.app.inject({ url: "/v1/auth/callback", remoteAddress: remote, headers: { "x-forwarded-for": xff } });
  const keys = (await t.db.selectFrom("rate_limits").select("key").where("key", "like", "signIn:%").execute()).map(
    (r) => r.key,
  );
  expect(keys.filter((k) => isIP(k.slice("signIn:".length)) === 0)).toEqual([]); // isIP from node:net
});
// with t = createTestApp({ config: testConfig({ TRUST_PROXY_HOPS: "1" }) )
```

Recorded result: `expected [ 'signIn:not-an-ip', …(3) ] to deeply equal []` (the four keys `not-an-ip`, `<script>`, `999.999.999.999` and `unknown`).

## D-2: over-long path parameters bypass the platform's error handling

**What happens.** Fastify's default `maxParamLength` is 100. `GET /v1/files/<300 characters>` (and any other route with
a path parameter) is answered with status 414 by the router itself, before the `onRequest` hooks and before the error
handler:

```
HTTP/1.1 414
content-type: application/json
{"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH","message":"'/v1/files/aaaa...' ..."}
```

**Impact.** Low. Recorded headers of that response: `content-type`, `content-length`, `date`, `connection` and nothing else, so
it has none of the platform's hardening (no `nosniff`, CSP, HSTS, `Cache-Control: no-store` or `x-request-id`). The
response is not RFC 9457 `application/problem+json` and has no `requestId` (BE-4), it echoes the
request path in the body (inert without a rendering context, but the headers that would make it so are missing), and it is not
authenticated or rate limited. Every id in the contract is a UUID, so legitimate
callers are unaffected.

**Suggested fix.** Handle the framework error in the platform: set `routerOptions.maxParamLength` to the longest
legitimate value (36 for UUIDs, `checkpointKey` is shorter) and map `FST_ERR_MAX_PARAM_LENGTH` through the same
problem builder as the not-found handler (`registerErrorHandling`, `frameworkErrors` option), answering 404 or 400.

**Failing test.**

```ts
it("D-2: an over-long path parameter gets the platform's problem+json 4xx, not Fastify's default error", async () => {
  const res = await t.app.inject({ url: `/v1/files/${"a".repeat(300)}` });
  expect(res.headers["content-type"]).toContain("application/problem+json");
  expect(res.json()).toMatchObject({ requestId: expect.any(String) });
  expect(res.body).not.toContain("a".repeat(300));
});
```

Recorded result: `expected 'application/json' to contain 'application/problem+json'`.

## D-3: static-looking 404 pages have no CSP

**What happens.** `proxy.ts` sets the per-request nonce CSP, but its matcher (`/((?!api/|api$|_next/|.*\.[A-Za-z0-9]+$).*)`)
skips `/api`, `/api/*`, `/_next/*` and every path that ends in an extension, so uploads and static files never pass
through it. Next.js answers an unknown path of that kind with its built-in HTML 404 page, which therefore has HSTS,
`nosniff`, `X-Frame-Options: DENY`, COOP and Referrer-Policy (from `next.config.ts`) but no `Content-Security-Policy`.

**Reproduction** (local stack, `docker-compose.yml` `stack` profile):

```
$ curl -sI http://localhost:3000/robots.txt | grep -i -E '^HTTP|content-security|content-type'
HTTP/1.1 404 Not Found
Content-Type: text/html; charset=utf-8
```

ZAP rule 10038 reports it on `/robots.txt` and `/sitemap.xml` (and, when the spider is seeded there, `/api` and
`/api/v1`); see `zap.md`.

**Impact.** Low: the page is static, reflects nothing from the request and has no forms, so there is nothing to inject
into. The gap is that a future change to that page (or a 404 that starts to echo the path) would run without the CSP
that protects every other HTML page. `zap.md` carries a narrow `OUTOFSCOPE` line for the two paths a staging scan reaches.

**Suggested fix.** Give these responses a CSP: either a static `Content-Security-Policy` in `next.config.ts` for the
source patterns the proxy skips (`/:path*.:ext`, `/api`, `/api/v1`) that is `default-src 'none'; frame-ancestors 'none'`
(these paths serve no scripts), or render a custom `not-found` with the nonce. Then delete the `10038` line in
`infra/zap/rules.tsv`. This needs the web CODEOWNER (`proxy.ts` and `next.config.ts` are protected paths).

## Observations (no defect, for the reviewers)

- **O-1: `preview` accepts any https authority host.** ADR-0002 says the mock IdP is allowed "only in local/preview", and
  the config accepts any `https://` host for `APP_ENV=preview` (only staging and production are pinned). A preview
  environment that carries the real `ENTRA_CLIENT_SECRET` and a wrong host would send that secret to the wrong host.
  Preview environments must therefore use a separate app registration and secret; say so in the deploy guide.
- **O-2: PDF content carries the API-wide CSP.** `GET /v1/files/{id}/content` for a PDF is served with
  `default-src 'none'; frame-ancestors 'none'` and no sandbox (PRODUCT_SPEC 11 asks for the sandbox on non-PDF only).
  The in-app viewer reads it with `fetch`, which the header does not affect. Confirm in staging that "Open in new tab"
  shows the PDF in Chrome, Edge, Safari and Firefox; if one blocks it, relax `default-src` for PDF only.
- **O-3: `X-Frame-Options: SAMEORIGIN` from helmet next to `frame-ancestors 'none'`.** Modern browsers use the CSP
  directive, so the effective policy is "never framed"; the web app's own pages send `DENY`. No action needed.
- **O-4: MFA claim unverified.** Whether Entra emits `amr` or `acrs` for this app registration is still a go-live gate
  (threat model R-1). The tests prove the API's behaviour for both claims (`mfa.int.test.ts`), not Entra's.
- **O-5: the sign-in redirect has no `Content-Type`.** `GET /` without a session answers `307` to `/sign-in` with no body
  and no `Content-Type` (ZAP rule 10019, the second line of `rules.tsv`). A body-less redirect cannot be mis-typed and
  `nosniff` is set, so no action is needed; if `proxy.ts` is touched for D-3, adding a type is free.
