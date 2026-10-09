# ADR-0005: Front end — Next.js App Router, same-origin API proxy, CSS Modules, TanStack Query

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md, ADR-0002, ADR-0004

## Context

Customer: React front end, look as close to the prototype as possible. Playbook frontend profile: Next.js App Router,
Server Components by default, browser data access only through `src/lib/api/`, styling Tailwind **or** CSS Modules,
CSP with nonces, performance budgets.

## Decision

- **Next.js 16 (App Router, React 19)**, `output: "standalone"`, deployed as its own Railway service.
- **Same-origin BFF proxy**: `app/api/v1/[...path]/route.ts` streams requests to the API over Railway private networking
  (`API_INTERNAL_URL`), forwarding only allowlisted headers (cookie, content-type, if-match, idempotency-key, x-csrf-token,
  range, x-request-id, origin) and adding `X-Forwarded-*`; responses stream back (uploads/downloads not buffered). The API
  is not publicly exposed. No business logic in the web tier.
- **Proxy (`src/proxy.ts`, Next 16's renamed middleware)**: per-request CSP nonce (`script-src 'nonce-…' 'strict-dynamic'`,
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`), optimistic redirect to `/sign-in` when no session
  cookie (real check is the API).
- **Styling: CSS Modules** porting the prototype CSS rule-for-rule on top of `@kr/design-tokens/tokens.css` (Tailwind
  would make pixel-faithful porting harder and add a dependency category).
- **Server state: TanStack Query** (interactive tracker, optimistic updates, 15 s refetch while visible); no global store.
- Pages: Server Components for shells; interactive features are client components at the lowest level.
- pdf.js (`pdfjs-dist`) is loaded lazily in the document viewer only (bundle budget).
- Next.js docs for this version ship in `node_modules/next/dist/docs/` — agents must read them (Next 16 changed conventions).

## Options considered

| Option                                      | Pros                                                         | Cons                                                                           |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Next.js + BFF proxy (chosen)                | Playbook default, same-origin cookies, CSP nonces, SSR shell | Extra hop (private network, ~1 ms)                                             |
| Vite SPA + API on a subdomain               | Simpler build                                                | Cross-site cookies/CORS, deviates from playbook, no nonce CSP without a server |
| Next.js with auth in the web tier (Auth.js) | Fewer API endpoints                                          | Splits security logic across tiers                                             |

## Consequences

The web service needs `API_INTERNAL_URL` only. All API calls from browser code go through `src/lib/api`.

## Compliance check

Header tests in e2e (CSP, HSTS, nosniff, frame-ancestors), size-limit + Lighthouse budgets, ESLint jsx-a11y.
