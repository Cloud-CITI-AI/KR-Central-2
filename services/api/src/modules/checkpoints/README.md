# checkpoints module

Checkpoint status, responsibility, KR note, client decisions and paid responses. Public entry: `index.ts`
(`checkpointsModule`). Reads the rendered checkpoint and bumps the job version through the `jobs` module's `index.ts`.

## Operations

| Operation          | Route                                                | Authorisation                                                                                                 |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `updateCheckpoint` | `PATCH /v1/jobs/{jobId}/checkpoints/{checkpointKey}` | per field: `checkpoint.status.edit`, `.responsibility.edit`, `.kr_note.edit`; `If-Match` = checkpoint version |
| `recordDecision`   | `PUT .../{checkpointKey}/decision`                   | `checkpoint.decision.record`; approval panel only (409 otherwise)                                             |
| `markPaid`         | `PUT .../{checkpointKey}/paid`                       | `checkpoint.paid.record`; paid panel only (409 otherwise); idempotent                                         |
| `undoPaid`         | `DELETE .../{checkpointKey}/paid`                    | `checkpoint.paid.record`; idempotent                                                                          |

Every operation first resolves job visibility (404), then capabilities (403). The fee proposal (1.0) also needs
`fee_proposal.view`.

## Audit actions

Written in the same transaction as the change, `entity_type` `checkpoint`, `entity_id` the checkpoint key, `job_id` set.
Free text (KR note, decision comment) is never copied into the audit trail; only its length is.

| Action                              | `changes`                                                         |
| ----------------------------------- | ----------------------------------------------------------------- |
| `checkpoint.status_changed`         | `status: {from, to}` (stored status)                              |
| `checkpoint.responsibility_changed` | `responsibility: {from, to}` (`null` = unassigned)                |
| `checkpoint.kr_note_changed`        | `krNoteLength: {from, to}`                                        |
| `checkpoint.decision_recorded`      | `decision: {from, to}`, `commentLength: {from, to}`               |
| `checkpoint.paid_recorded`          | `paidAt: {from: null, to}`, `status: {from, to: "completed"}`     |
| `checkpoint.paid_undone`            | `paidAt: {from, to: null}`, `status: {from, to: "not_completed"}` |

## Behaviour worth knowing

- A decision does NOT change the status (PRODUCT_SPEC §5.5). A declined decision needs a non-blank comment (R14: contract
  schema and DB CHECK).
- Paid (R13): `markPaid` sets `paid_at`/`paid_by` (injected clock) and Completed; `undoPaid` clears both and sets Not
  completed. Both are no-ops when already in that state.
- A KR note is accepted only on a checkpoint that has a comment box (400 otherwise).
- The response is the viewer's `CheckpointState`: effective status (agency exclusion), restricted content withheld.
