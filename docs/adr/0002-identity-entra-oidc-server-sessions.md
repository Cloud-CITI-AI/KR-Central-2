# ADR-0002: Sign-in with Microsoft Entra ID (single-tenant OIDC) and server-side sessions

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md, ADR-0003, ADR-0014

## Context

Requirement: "Sign in is SSO to the KR Surveys tenant". KR Surveys runs Microsoft 365 (SharePoint/Teams). Playbook
docs/07 §7.4: central IdP via OIDC, no custom password storage, MFA for admins, session rotation on privilege change;
SC-B4: no custom crypto or token parsing; ASVS L3 for authentication.

## Decision

- IdP: **Microsoft Entra ID**, single-tenant app registration in the KR tenant (authority
  `https://login.microsoftonline.com/{ENTRA_TENANT_ID}/v2.0`). Web platform redirect URI
  `{PUBLIC_BASE_URL}/api/v1/auth/callback`, post-logout redirect URI `{PUBLIC_BASE_URL}/signed-out` (no front-channel logout
  URL: see Sessions); optional claims
  `email`, `acct`; no implicit grant; ID tokens only (no access tokens to Graph for users).
- Flow: authorization code + **PKCE (S256)** as a **confidential client** (client secret, rotated ≤ 90 days; certificate
  credential is a later hardening). Library: `openid-client` v6 (discovery, JWKS, ID token validation); the API also
  checks `tid` equals the configured tenant and `nonce`. State/nonce/verifier stored server-side (`auth_flows`, 10 min).
- **Login-CSRF binding** (added after review): `startLogin` sets `__Host-kr_auth` (random 256-bit, HttpOnly, Secure,
  SameSite=Lax, 10 min) and stores its SHA-256 in the flow; `completeLogin` requires the cookie to match, so a callback
  URL minted for an attacker's account cannot sign a victim in as the attacker.
- **Authority pinning**: `ENTRA_AUTHORITY_HOST` may point at the mock IdP only in local/preview; staging and production
  refuse to start unless it is `https://login.microsoftonline.com` (a wrong value would be a sign-in bypass). The mock
  IdP is a dev dependency and never in a production image.
- **Email claims**: email is never an identity key. Guests' grants are matched on the `email` claim only (never
  `preferred_username`/UPN), and not when `xms_edov=false`; members' staff-domain rule may use the UPN.
- Identity key: (`tid`, `oid`) — not email, not `sub`.
- Sessions: opaque 256-bit random id in `__Host-kr_session` (HttpOnly, Secure, SameSite=Lax, Path=/); only its SHA-256
  is stored in Postgres (`sessions`). Idle 120 min sliding, absolute 12 h. New id on every sign-in; sessions revoked on
  role change, disable, logout. No JWTs in the browser; no token storage in localStorage.
  **No front-channel logout**: the `/signed-out` page is static and revokes nothing, and the web sends
  `X-Frame-Options: DENY` / `frame-ancestors 'none'`, which would block Entra's iframe request anyway, so the app
  registers no front-channel logout URL. A sign-out at Microsoft elsewhere does not end the tracker session; it ends at
  the idle or absolute expiry, or at logout in the tracker. A frameable handler that revokes the session by `sid` would
  be a separate decision (it needs a CSP and framing exception for that one route).
- CSRF: per-session token (`GET /v1/me` → `X-CSRF-Token` header) + `Origin` check + SameSite=Lax.
- The browser only talks to the web origin; the API is reached through the web app's same-origin proxy (ADR-0005), so
  the cookie is first-party and the API needs no CORS.
- MFA for admins via Entra Conditional Access; the API additionally requires MFA evidence on admin-only endpoints
  when `REQUIRE_MFA_FOR_ADMIN=true`: `amr` contains `mfa` (`ADMIN_MFA_EVIDENCE=amr`) or the `acrs` claim contains a
  Conditional Access authentication context (`ADMIN_MFA_EVIDENCE=acrs`). Whether Entra v2 ID tokens for this app carry
  `amr` is **unverified**; proving one of the two in staging is a go-live gate (deploy guide).

## Options considered

| Option                                  | Pros                                                                          | Cons                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Entra ID OIDC, server sessions (chosen) | Matches M365 tenant, guests via B2B, revocable sessions, no tokens in browser | Session table, CSRF handling                                                            |
| Entra + Auth.js in Next.js              | Less code                                                                     | Auth logic in the web tier; harder to share with API; JWT session cookies not revocable |
| Entra External ID (CIAM) for clients    | Self-service sign-up                                                          | Separate tenant; Craig asked for the KR tenant                                          |
| Magic links for clients                 | Easy for clients                                                              | Custom auth, against playbook (central IdP)                                             |

## Consequences

Clients/architects need Entra B2B guest accounts (ADR-0014). Local development and tests use a mock OIDC provider
(`packages/mock-idp`). Auth code is tier High (two approvals incl. security CODEOWNER).

## Compliance check

Integration tests against the mock IdP for: state mismatch, nonce mismatch, missing/mismatched browser-binding
cookie, wrong tenant, expired flow, disabled user, guest email fallback refused;
route-table test (every non-public route requires a session); ZAP baseline on staging; cookie flags asserted in tests.
