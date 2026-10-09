# access module

The access manager (PRODUCT_SPEC §3.4, §6, ADR-0014): staff grant a client or architect access to ONE job by email.
Public entry: `index.ts` (`accessModule`, `createAccessModule({ inviter })` for tests).

| Operation           | Route                           | Behaviour                                                                                       |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `listAccessGrants`  | `GET /v1/access-grants`         | job number, email order; filters `jobId`, `status`; revoked only with `status=revoked`; cursor  |
| `createAccessGrant` | `POST /v1/access-grants`        | lower-cased email; duplicate pending/active -> 409 "x@y.z is already on the list for S-0001."   |
| `revokeAccessGrant` | `DELETE /v1/access-grants/{id}` | idempotent; effective on the user's next request (job visibility reads the grant every request) |

All three need the global capability `access.manage` (staff, kr_admin, admin). A new grant is Pending, or Active and bound at
once when exactly one external account already has that email (the response shows the account's name). Activation at sign-in
is WP-07 (`auth` module).

## Guest invitations (flag `entra-guest-invites`, off by default)

With the flag on, a Pending grant calls the `GuestInviter` (Microsoft Graph `POST /v1.0/invitations`, client-credentials token,
one 10 s deadline, no retries). The result is stored on the grant (`invitation_status` sent/failed, `invitation_error`); a
failure never fails the grant. With the flag off Graph is never called. Tests use the fake in `testing.ts`.

## Audit actions

`entity_type` `access_grant`, `job_id` set: `access_grant.created` (`email`, `role`, `status`), `access_grant.revoked`
(`status`), `access_grant.invitation_sent` / `access_grant.invitation_failed` (`invitationStatus`).
