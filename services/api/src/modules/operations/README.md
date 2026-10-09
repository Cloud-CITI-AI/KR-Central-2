# operations module

Status of asynchronous operations (ADR-0006): `GET /v1/operations/{operationId}` is what the web app polls after any
202 + `Location` answer. Public entry: `index.ts` (`operationsModule`, and `toOperation` for the modules that start
operations).

## getOperation

- Authorisation: the operation's job must be visible to the caller (`resolveJobAccess`, `job.read`); an unknown id and an
  invisible job are the same 404.
- `Retry-After: 2` while the operation is `queued` or `running`.
- The `result` is returned only for `conditions.extract` and `conformance.read` and only when it matches the contract
  schema (otherwise null and a warn log `operation_result_unreadable`).
- The `error` of a `failed` operation is user-safe: known codes (`not_a_pdf`, `encrypted_pdf`, `too_many_pages`,
  `unreadable_pdf`, `render_failed`, `invalid_msg`, `invalid_eml`, `timeout`, `lease_expired`) use a message owned by the
  API; any other code's worker message is shown only if it is short plain prose (no stack frames, paths, SQL, URLs or
  newlines), else "The task could not be completed. Try again, or contact KR Surveys if it keeps failing.". The worker
  (WP-12) should record a person-oriented `error_message` for each code it adds.
