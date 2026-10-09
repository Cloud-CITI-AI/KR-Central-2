// Feature folder owned by WP-18. See docs/plan/WORK_PACKAGES.md.

Admin pages (PRODUCT_SPEC §9): `/admin/users` (capability `users.manage`) and `/admin/audit` (`audit.read`).

- The route files under `src/app/(app)/admin/` call `requireCapability()`; without the capability the page is the not-found page. The API enforces the same rules on every call.
- `ProblemNotice` shows the multi-factor 403, the last-admin 409 and the stale 412 (and any other failure) with the request id.
- Contract gaps worked around here (see the WP-18 hand-off): `updateUser` has no `If-Match` and `User` has no version, so none is sent; `listAuditEvents` has no date parameters, so the Perth date range is applied in `AuditPage` by paging back until the start of the range.
