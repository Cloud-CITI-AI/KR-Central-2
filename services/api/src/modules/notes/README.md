# notes module

Job notes (PRODUCT_SPEC §5.7). Public entry: `index.ts` (`notesModule`).

| Operation    | Route                                    | Authorisation                                                             |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------- |
| `listNotes`  | `GET /v1/jobs/{jobId}/notes`             | `job.read`; newest first, 50 per page, cursor = last note id              |
| `createNote` | `POST /v1/jobs/{jobId}/notes`            | `notes.create` (anyone with job access); `Idempotency-Key`                |
| `deleteNote` | `DELETE /v1/jobs/{jobId}/notes/{noteId}` | staff (`notes.delete.any`) any note, everyone else their own; soft delete |

The audience (all / surveyor / client) is a LABEL only: every party on the job reads every note. An invisible or archived job
is 404 before anything else.

## Audit actions

Same transaction as the change, `entity_type` `note`, `job_id` set. The note text is never copied; only its length is.

| Action         | `changes`                                        |
| -------------- | ------------------------------------------------ |
| `note.created` | `audience: {null, to}`, `bodyLength: {null, to}` |
| `note.deleted` | `deleted: {false, true}`                         |
