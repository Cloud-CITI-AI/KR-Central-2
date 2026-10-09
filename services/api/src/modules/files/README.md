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

## getFile and getFileContent

- A file is visible when it is not removed and its job is visible to the caller (`job.read`; archived jobs and jobs of
  other people are the same 404). The fee proposal's files (checkpoint `1.0`) are a 404 without `fee_proposal.view`.
- `getFileContent` serves only `clean` or `skipped` files; otherwise 409 with the spec message: `pending` "This file is
  still being checked for viruses." (`file-not-ready`), `infected` "Blocked – failed the virus scan" and `error`
  "Couldn't be checked for viruses – remove it and upload it again" (both `file-rejected`).
- Headers (PRODUCT_SPEC 11): the sniffed content type (text always `text/plain; charset=utf-8`); `inline` only for PDF,
  image, video and text and only when asked (`?disposition=inline`, the default), otherwise `attachment`, with an ASCII
  `filename` and the RFC 5987 `filename*`; `Cache-Control: private, no-store`; `X-Content-Type-Options: nosniff`; the
  sandbox CSP for everything but a PDF; `Accept-Ranges: bytes`.
- `Range`: one byte range gives 206; several ranges, other units or malformed values are served whole; a range past the
  end is a 416 problem with `Content-Range: bytes */size`. A clean file whose object is missing is a 404 and a
  `file_object_missing` error log.

## deleteFile and pasteEmail

- `deleteFile` is a soft delete (`deleted_at`, `deleted_by`); the object is purged by the retention sweep. Staff remove
  any file, everyone else only their own uploads (403 otherwise); two concurrent removals give one 204 and one 404.
- `pasteEmail` (`emails.add`, staff): the text becomes a `text/plain` file named after its subject in 4.3 and an
  already parsed `email_messages` row (`is_pasted`, subject = first line cut at 90 characters, sender "Pasted text").
  The file is scanned like every upload. The worker must not parse it again (WP-12: skip `is_pasted`).

## downloadJobPackage

- Streamed with archiver, no temp files: entries are added one at a time and each storage object is opened only after
  the previous entry was written. A storage failure destroys the response (the download fails, no short zip); a
  disconnect stops the reads.
- Name `<job number> – subdivision files.zip`, top folder `<job number> – <address>`, a folder per stage, a sub-folder
  per checkpoint (emails in `/Query emails`), condition evidence under the stage of its agency, duplicates suffixed
  ` (2)`, and `Job summary.txt` first (job line, download time, conformed and outcome dates, every stage and checkpoint
  with its effective status, the conditions with comments, the job notes). Folder names come from the `@kr/workflow`
  presentation helpers.
- Only `clean` or `skipped` files that are not removed; the fee proposal's files only with `fee_proposal.view`; files of
  superseded conditions are left out.

## Audit actions

Written in the same transaction as the change (the package download in its own, before streaming). File contents and
free text are never copied into the audit trail.

| Action                   | `entity_type` / `entity_id` | `changes`                                                                                            |
| ------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `file.uploaded`          | `file` / file id            | `name`, `kind`, `sizeBytes` (all `{from: null, to}`), plus `checkpointKey` + `slot` or `conditionId` |
| `file.deleted`           | `file` / file id            | `deleted: {from: false, to: true}`, `name: {from: <name>, to: null}`                                 |
| `email.pasted`           | `file` / file id            | `textLength: {from: null, to}`                                                                       |
| `job.package_downloaded` | `job` / job id              | `fileCount: {from: null, to}`                                                                        |

## Contract notes

`getFileContent` answers 400 (an invalid `disposition`) and 416 (Range past the end, with `Content-Range: bytes */size`),
`getFile` answers 400 for a malformed id, and `uploadFile` and `pasteEmail` take an `Idempotency-Key`; all of this is
declared in `packages/contracts` and checked against `openapi.yaml` by `files.contract.test.ts`.
