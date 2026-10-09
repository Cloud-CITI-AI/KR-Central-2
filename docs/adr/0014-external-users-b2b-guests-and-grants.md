# ADR-0014: External users are Entra B2B guests; job access through email-keyed grants

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md, ADR-0002, ADR-0003

## Context

Clients and architects must sign in "via SSO to the KR Surveys tenant" yet see only their own job. The prototype stored
access entries (email, role, job) as "pending" and planned to send access later.

## Decision

- Externals authenticate as **Entra B2B guests** of the KR tenant (they use their own work/Microsoft account or email
  one-time passcode as configured by KR IT). They always get global role `external`.
- Staff create **grants** (email, role client|architect, job). On a guest's sign-in, pending grants matching the email
  (case-insensitive) activate and bind to the user id; afterwards access follows the user id, not the email.
- Optional flag `entra-guest-invites` (default off): creating a grant also calls Microsoft Graph `POST /invitations`
  (application permission `User.Invite.All`, client-credentials token for the same app registration) with the app URL
  as redirect; invitation status is stored on the grant. Off ⇒ KR IT invites guests manually (documented).
- Visibility is checked per request (revocation is immediate); externals get 404 for jobs they cannot see.

## Options considered

| Option                                      | Pros                                                              | Cons                                             |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| B2B guests + grants (chosen)                | Single tenant, Conditional Access applies to guests, no passwords | Guests must redeem an invitation                 |
| Entra External ID tenant                    | Self-service sign-up                                              | Second tenant to run; not "the KR tenant"        |
| Grants keyed only by email at every request | Simple                                                            | Email claims can change; binding to oid is safer |

## Consequences

Email claim trust: activation requires the email claim from the KR tenant's token for a guest account; KR IT controls
who is invited. Open question: allow email one-time passcode for clients without Microsoft accounts (KR tenant setting).

## Compliance check

Integration tests: activation on sign-in, revoked grant denies, guest never becomes admin, architect cannot see fee
proposal, external without grant sees nothing.
