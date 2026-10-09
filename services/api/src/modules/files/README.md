# files module

Uploads, downloads, removal, the job package zip and pasted emails. Public entry: `index.ts` (`filesModule`). Layers:
`http/` (routes, multipart reading, response mapping) -> `domain/` (pure rules) -> `data/` (Kysely). Slots and accepted
kinds come from `@kr/workflow` (`findSlot`), permissions from `@kr/contracts`, sniffing and storage keys from
`@kr/storage` (`classifyContent`, `objectKeyFor`, `sanitiseFileName`), the queue from `@kr/db` (`enqueueOperation`).

## Operations

| Operation            | Route                            | Authorisation                                                                   |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| `uploadFile`         | `POST /v1/jobs/{jobId}/files`    | job visible (404); the slot's capability, or `conditions.evidence.upload` (403) |
| `getFile`            | `GET /v1/files/{fileId}`         | `job.read` on the file's job; fee proposal files need `fee_proposal.view` (404) |
| `getFileContent`     | `GET /v1/files/{fileId}/content` | same as `getFile`; only `clean` or `skipped` files (409 otherwise)              |
| `deleteFile`         | `DELETE /v1/files/{fileId}`      | `files.delete.any`, or `files.delete.own` for the caller's own uploads          |
| `downloadJobPackage` | `GET /v1/jobs/{jobId}/package`   | `package.download`; fee proposal files only with `fee_proposal.view`            |
| `pasteEmail`         | `POST /v1/jobs/{jobId}/emails`   | `emails.add`                                                                    |

## uploadFile

- Multipart, fields first (`checkpointKey` + `slot`, or `conditionId`), then one `file` part. The file is never
  buffered: it is capped at `UPLOAD_MAX_BYTES` (413 with "<name> is larger than N MB."), the first `SNIFF_BYTES` are
  sniffed (`classifyContent`; the name and the declared type are never trusted), the slot's accept list is enforced
  (415 with a reason), then the stream goes to storage while the sha256 is computed.
- Order of checks: job visibility (404) -> fields (400) -> capability (403) -> condition is current on this job (404)
  -> bytes. Nothing is stored for a request that fails a check; an object written for a request that later fails
  (a trailing part, a failing transaction, an `Idempotency-Key` replay) is deleted again.
- Slot uploaders map to capabilities: `staff` -> `files.upload.staff_slots`; `staff_and_client` and
  `staff_and_external` -> `files.upload.client_slots`. The fee proposal slot also needs `fee_proposal.view`.
  Condition evidence takes PDF, photo, video and text.
- The `files` row is `pending` (`skipped` when `MALWARE_SCAN_MODE=disabled`) and a `file.scan` operation with payload
  `{"fileId"}` is queued in the same transaction. An email file also gets an `email_messages` row (`pending`); with
  scanning disabled the API queues `email.parse` (payload `{"fileId"}`) itself, otherwise the worker does after a clean
  scan. The 201 body is the contract's `UploadResult`: the file and that operation (or `null`).
- `Idempotency-Key` is honoured (bound to the fields, name and sha256 of the file).

## Audit actions

Written in the same transaction as the change, `entity_type` `file`, `entity_id` the file id, `job_id` set. File
contents are never copied into the audit trail.

| Action          | `changes`                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `file.uploaded` | `name`, `kind`, `sizeBytes` (all `{from: null, to}`), plus `checkpointKey` + `slot` or `conditionId` |
