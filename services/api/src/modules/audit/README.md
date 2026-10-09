# audit module

The audit trail, read only (PRODUCT_SPEC §9.2, DATA_MODEL §6). Public entry: `index.ts` (`auditModule`). Other modules write
events with `platform/audit.ts` in the same transaction as their change; this module never writes, and the app role has no
UPDATE or DELETE on `audit_events`.

| Operation         | Route                  | Authorisation                                   |
| ----------------- | ---------------------- | ----------------------------------------------- |
| `listAuditEvents` | `GET /v1/audit-events` | `audit.read` (admin, kr_admin) and MFA evidence |

Newest first (identity id), 50 per page, cursor = last id. Filters: `jobId`, `actorId`, `action` (a literal prefix, so
`access_grant.` does not match `accessxgrant.`). `from` and `to` are inclusive Perth business dates: `domain/occurredRange`
turns them into UTC bounds with `@kr/workflow` (a Perth day runs from 16:00 UTC to 16:00 UTC). A reversed range is a 400 from the
contract, and the route repeats the check as a second line of defence.
