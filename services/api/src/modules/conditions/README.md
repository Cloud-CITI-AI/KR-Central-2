# conditions module

WAPC conditions: starting the Decision Letter extraction and the conformance reading as tracked operations, and editing a
condition within the caller's field permissions. Public entry: `index.ts` (`conditionsModule`). Maps operations through the
`operations` module's `toOperation` and bumps the job version through the `jobs` module's `index.ts`. The reading itself is
done by the worker (WP-12); this module only validates and queues.

## Operations

| Operation                   | Route                                             | Authorisation                                                                                                               |
| --------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `startConditionsExtraction` | `POST /v1/jobs/{jobId}/conditions/extractions`    | `conditions.extract`; `Idempotency-Key` required; 202 + `Location: /v1/operations/{id}`                                     |
| `startConformanceReading`   | `POST /v1/jobs/{jobId}/conformance-readings`      | `conformance.read`; `Idempotency-Key` required; 202 + `Location`                                                            |
| `updateCondition`           | `PATCH /v1/jobs/{jobId}/conditions/{conditionId}` | `clientComment` -> `conditions.client_comment.edit`; every other field -> `conditions.edit`; `If-Match` = condition version |

Every operation first resolves job visibility (404), then capabilities (403), then the request (400/409/412/428).

## Requests

- Extraction: the file must be a clean (or `skipped`) PDF in the 5.0 `decision` slot of the same job whose name contains
  "decision" (case-insensitive). If the job has current conditions, `replaceExisting: true` is required (409 with the
  PRODUCT_SPEC 5.5 count text otherwise). Enqueues `conditions.extract` `{jobId, fileId, replaceExisting}`.
- Conformance: the file must be a clean PDF in the 4.2 `conformance` slot of the same job. Enqueues `conformance.read`
  `{jobId, fileId, allowAi}` with `allowAi` = the `ai-stamp-reading` flag at request time.
- A file that is missing, deleted, from another job or in another slot gets one 409 message; a pending or unscannable file is
  409 `file-not-ready`, an infected one 409 `file-rejected`.
- The same `Idempotency-Key` from the same user returns the same operation (`Idempotent-Replayed: true`); the same key with a
  different request is 409.
- A superseded (re-extracted) condition is 404 for `updateCondition`.

## Audit actions

Written in the same transaction as the change; `job_id` set; free text is never copied into the audit trail (only its length).

| Action                            | Entity (`entity_id`)       | `changes`                                                                                                                          |
| --------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `conditions.extraction_requested` | `operation` (operation id) | `fileId: {from: null, to}`, `replaceExisting: {from: null, to}`                                                                    |
| `conformance.reading_requested`   | `operation` (operation id) | `fileId: {from: null, to}`                                                                                                         |
| `condition.updated`               | `condition` (condition id) | `isCleared`, `responsibility`, `agency`, `agencyGuessed` as `{from, to}`; `krCommentLength`, `clientCommentLength` as `{from, to}` |
