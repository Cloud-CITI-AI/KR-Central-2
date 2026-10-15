# ZAP baseline: rules and how they were derived

The staging deploy runs an OWASP ZAP baseline scan (`.github/workflows/deploy.yml`, step "DAST baseline (OWASP ZAP)",
`zaproxy/action-baseline` v0.14.0, `rules_file_name: infra/zap/rules.tsv`, `fail_action: true`). A baseline scan is
passive: it spiders the public site for one minute and runs ZAP's passive rules on what it sees. With `fail_action: true`
any alert that is not overridden (default action WARN) fails the deploy, which is the intent (checklist SC-C3: no high
alerts; here no alert at all). This page records how the overrides were derived and why each exists.

## The rules file

`infra/zap/rules.tsv` is read by `zap-baseline.py -c`. Each line is `<rule id><TAB><action><TAB><argument>`:

- `OUTOFSCOPE` with a URL regex drops that rule's alerts for matching URLs only; the rule stays active everywhere else.
- Any other rule keeps its default action (WARN).
- We use no `IGNORE` lines: ignoring a rule would silence it for every page, including the nonce CSP pages it protects.

| Line | Rule                                  | URLs it covers                                                           | Why it is acceptable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 10038 Content Security Policy not set | `/robots.txt`, `/sitemap.xml`                                            | The paths are 404s that Next.js answers with its framework 404 page. `apps/web/src/proxy.ts` sets the nonce CSP but its matcher skips every path that ends in a file extension (uploads and static files must not pass through it), so these 404s carry the other hardening headers (HSTS, nosniff, `X-Frame-Options: DENY`, COOP, Referrer-Policy) but no CSP. The page is static, has no forms and reflects nothing from the request. Tracked as defect D-3 in `findings.md`; delete the line when it is fixed. |
| 2    | 10019 Content-Type header missing     | `/` (the root only)                                                      | `GET /` on an unauthenticated browser is a 307 to `/sign-in` produced by `proxy.ts`. A redirect has no body, so there is nothing to mis-type or sniff, and `X-Content-Type-Options: nosniff` is present. Tracked as observation O-5 in `findings.md`.                                                                                                                                                                                                                                                             |
| 3    | 10044 Big Redirect Detected           | `/robots.txt`, `/sitemap.xml`                                            | On staging both paths answer a 307 to `/sign-in` (locally they were framework 404s, row 1). ZAP flags a redirect whose body is longer than its `Location` suggests. The request carries no session, so the body cannot hold user data. Where the 307 comes from is not yet known (`proxy.ts` skips paths with a file extension); find out, and fix it in the product if it is the proxy, before relying on this line.                                                                                             |
| 4    | 10109 Modern Web Application          | `/robots.txt`, `/sitemap.xml`                                            | Informational: ZAP recognised a JavaScript application, a hint for choosing a scan type, not a weakness.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5    | 10112 Session Management Response     | `/api/v1/auth/login` only                                                | Informational: ZAP saw the login set the session cookie, which is that endpoint's job. The cookie's flags are checked by 10010, 10011 and 10054, which stay active everywhere.                                                                                                                                                                                                                                                                                                                                    |
| 6    | 10049 Non-Storable Content            | `/`, `/robots.txt`, `/sitemap.xml`, `/sign-in` (with or without a query) | Informational: these answers are `no-store` (`proxy.ts` sets it on the sign-in redirect) or otherwise not cached. Not caching sign-in and redirect answers is the intent.                                                                                                                                                                                                                                                                                                                                         |
| 7    | 10049 Non-Storable Content            | `/_next/static/media/*.woff2`                                            | Informational: public, content-hashed font files carry no user data, so a cache miss costs only bandwidth. Why staging serves them as non-storable (Next.js normally marks `/_next/static` immutable) is not yet known; worth checking the edge's caching, not a security issue.                                                                                                                                                                                                                                  |

Every line is an anchored regex (`^https?://[^/]+...$`), so a new page that triggers the same rule is not covered. Rows 3 to 7
were added after the first HTTPS staging run (deploy of v1.0.4, 2026-10-15), which reported them as WARN-NEW.

## How the overrides were derived (local baseline run, 2026-10-09)

Stack: the repository's `docker-compose.yml` `stack` profile built from this branch (commit before this file): `postgres`,
`s3` (adobe/s3mock), `bootstrap`, `migrate`, `api` and `web`; `worker` and `clamav` were not started because a baseline
scan never reaches them. Scanner: `zap-stable` 2.17.0, digest
`sha256:7aaa659b0d43078febd82e29bad112285c370727e86ab8340444220e17d9f0d2` (see the note below on the image name).

```sh
# 1. The stack (the web service is the only public one in production; here nothing is published on the host)
docker compose -p krzap --profile stack up -d --build postgres s3 bootstrap migrate api web
# s3 needs a few seconds before `migrate` can reach it; if `migrate` exited, run the same command again.

# 2. The scan, from a container on the stack's network, exactly as the action runs it (spider 1 minute, passive rules)
mkdir -p zap-out && chmod 777 zap-out && cp infra/zap/rules.tsv zap-out/
docker run --rm --network krzap_default -v "$PWD/zap-out:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://web:3000 -c rules.tsv -J report.json -w report.md

# 3. Clean up
docker compose -p krzap --profile stack down -v
```

Results, all from the same stack:

| Run                                                              | Exit | Result                                                                                                                                                                            |
| ---------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No rules file (`-g` template only)                               | 2    | `WARN-NEW: 1, PASS: 59`: 10038 on `/sitemap.xml` and `/robots.txt` (both 404)                                                                                                     |
| Rules file with line 1 only                                      | 2    | `WARN-NEW: 1, PASS: 60`: 10019 on `http://web:3000` and `http://web:3000/` (307)                                                                                                  |
| Rules file as committed (both lines), run twice                  | 0, 0 | `FAIL-NEW: 0, WARN-NEW: 0, PASS: 61` both times                                                                                                                                   |
| Seeding the spider at `/api/v1/me` instead of `/`, no rules file | 2    | Also reports 10038 on `/api` and `/api/v1` (more framework 404s) and 10019 on `/`; the deploy step starts at the site root and never reaches those two paths, so no line for them |

All other passive rules passed on the pages the spider reached (61 PASS lines in the final run), including 10010 and 10011
(cookie flags: no cookie is set on those pages), 10020 (framing), 10021 (nosniff), 10035 (HSTS), 10054 (SameSite), 10055
(CSP), 10062, 10096 and 10097 (disclosure) and 90022 (error disclosure). On plain HTTP some of these pass because they do not
apply (HSTS, `Secure`); they are judged on the first HTTPS staging run.

## What this scan does and does not cover

- It is unauthenticated: it sees what the spider reaches from the site root (the sign-in page and its assets) plus ZAP's
  probes of well-known files. By hand, `/api/healthz`, `/api/readyz` and the 401 answer of `/api/v1/me` carried the same
  hardening headers (curl, this run). Everything behind sign-in is covered by the API tests in
  `services/api/test/security/` (see `threat-model.md`, section 5), not by ZAP. An authenticated scan needs a test
  account in the staging tenant and is a later decision for KR.
- It is passive: no attack traffic. Active scanning against staging would write data; do it only against a throwaway
  environment.
- The local run is plain HTTP on a Docker network. Staging is HTTPS behind Railway's edge, so rules that depend on TLS or
  on edge headers (HSTS, `Server`, `Via`, cookie `Secure`) are judged on the first staging run. If it reports an alert
  that this file does not cover, fix it in the product if it is real; otherwise add a narrow `OUTOFSCOPE` line here, with a
  row in the table above, in the same pull request.

## Image name

The workflow's action pulls `ghcr.io/zaproxy/zaproxy:stable`. The sandbox this run was made in cannot reach GHCR's blob
host (the egress proxy returns 403 for `pkg-containers.githubusercontent.com`), so the scan used the same project's Docker
Hub image `zaproxy/zap-stable` through `mirror.gcr.io` (`mirror.gcr.io/zaproxy/zap-stable:latest`, ZAP 2.17.0, digest above).
The ZAP project publishes its stable release under both names; the digests of the two registries were not compared. The stack images were built with the
repository Dockerfiles, using a base image that carries the sandbox's proxy certificate
(`docker build --build-context node:24-alpine@sha256:...=docker-image://kr-local/node-ca:24`); that substitution changes no
application file.
