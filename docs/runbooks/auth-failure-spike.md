# auth-failure-spike

Alert: [auth-failure-spike](../observability/alerts.md#auth-failure-spike) (page). Security (SC-D4). Fires when
failed sign-ins pass 30 in 5 minutes and more than 3 times the previous day's hourly average, or when authorisation
denials double against the previous day with at least 20 in 15 minutes. The sign-in rate limit is 20 a minute per
client IP.

## Symptoms

- Many users cannot sign in at once (a fault), or failures come from a few sources and no real users complain (an attack).
- Log events `authn_failure` with a `reason`, `authn_exchange_failed`, `rate_limited` (with `limit`), and authorisation
  denial events.

## Dashboards

5 Security and auth (failures against the 24 h average, denials, rate limits), then 1 Service overview.

## Diagnose (read-only)

1. **Which reason.** Count `authn_failure` log lines by `reason` for the window. The reasons are `cancelled`,
   `wrong_tenant`, `disabled`, `expired`, `unverified_email` and `failed`. Subjects are pseudonyms, never emails; do not
   try to reverse them.
2. **Everybody fails with `failed` or `authn_exchange_failed`.** The Entra app registration is the usual cause: client
   secret expired (90-day rotation, checklist E7 and E8 in `docs/deploy/railway.md`), redirect URI or front-channel
   logout URL changed, or Entra itself is degraded (Microsoft 365 service health). Check the date the secret was created
   against the calendar, then [secrets-rotation](secrets-rotation.md).
3. **`rate_limited` with `limit: signIn` across ordinary users.** Every user shares one bucket: the API is seeing the
   web service's address instead of the client's. `TRUST_PROXY_HOPS` was changed or the forwarding chain changed. Repeat
   "Verifying X-Forwarded-For handling in staging" in `docs/deploy/railway.md`.
4. **`wrong_tenant` or `disabled` in volume.** Outsiders trying the app, or an offboarded group retrying. KR IT can see
   the same attempts in Entra sign-in logs (source address, Conditional Access result).
5. **Authorisation denials.** Group them by route and (pseudonymised) subject in the logs. A jump from one subject on
   many job ids is probing; a jump across many subjects starting at a deploy is a permission regression, so compare
   with the deploy markers ([deploy-and-rollback](deploy-and-rollback.md)).
6. **A success after failures.** `authn_success` from a subject that just failed repeatedly, or a first-ever staff
   sign-in out of hours, needs KR IT to check that account in Entra.

## Mitigate

1. Fault: fix the cause (rotate the secret, restore the redirect URI, correct `TRUST_PROXY_HOPS` through the normal
   change path) and verify with one real sign-in.
2. Attack: the IP rate limit is already in force. Ask KR IT to block the sources or tighten Conditional Access in Entra
   (the tenant is the front door). If Cloudflare is in front of the domain (ADR-0008 exception 6), add a WAF or
   rate-limit rule there.
3. A compromised account: disable it in `/admin/users` (this revokes its sessions) and reset it in Entra. Sessions can
   all be invalidated if needed ([secrets-rotation](secrets-rotation.md), "Invalidate every session").
4. Regression: roll back ([deploy-and-rollback](deploy-and-rollback.md)).

## Escalate

Any suspected successful unauthorised sign-in, or denials that reached data for a job the subject had no grant on (404
should be the answer): security incident ([incident-response](incident-response.md)), severity 1 or 2. The alert text
for a pure rate-limit spike with no success stays a ticket after one hour of quiet.
