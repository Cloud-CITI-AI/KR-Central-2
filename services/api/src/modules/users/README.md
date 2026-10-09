# users module

User administration for admins (PRODUCT_SPEC §9.1, ADR-0003). Public entry: `index.ts` (`usersModule`).

| Operation    | Route                  | Behaviour                                                                            |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------ |
| `listUsers`  | `GET /v1/users`        | `q` (name or email, literal substring), `role`; display name order; cursor = last id |
| `updateUser` | `PATCH /v1/users/{id}` | `role` and/or `status`; `If-Match` is optional (see below)                           |

Both need `users.manage` (admin only) and MFA evidence (`assertMfaForAdmin`).

Both return a `ManagedUser` (a `User` plus its row `version`); `updateUser` also sets the `ETag`.

## If-Match is optional

The contract declares `If-Match` as an optional header on `updateUser` (decision log, WP-11). When it is sent it is checked:
malformed gives 400, stale gives 412. When it is missing the change goes ahead (last write wins) and there is no 428. The
last-admin guarantee comes from the row locks, not from `If-Match`.

## Guards

- Nobody changes their own role or status (403). A guest account stays `external` (409).
- The last active admin can be neither demoted nor disabled (409 "There must be at least one active admin."). The target and
  all active admins are locked by ONE `SELECT ... FOR UPDATE ... ORDER BY id` in the change's transaction, so two concurrent
  demotions give exactly one success.
- A change revokes all of the user's sessions in the same transaction (reason `role_changed`, or `user_disabled`).
- A request that changes nothing writes no audit event, no version bump and does not revoke sessions.

## Audit actions

`entity_type` `user`, no job: `user.role_changed` (`role`), `user.status_changed` (`status`), each `{from, to}`.
