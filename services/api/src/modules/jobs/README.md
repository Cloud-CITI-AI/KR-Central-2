# jobs module

Dashboard list and facets, job create / read / edit / archive. Public entry: `index.ts` (`jobsModule`). Layers: `http/`
(routes, response mapping) -> `domain/` (pure rules) -> `data/` (Kysely). Rules come from `@kr/workflow`
(`summariseJob`, `effectiveState`, `summariseStage`, `compareJobNumbers`, `outcomeDateFor`); shapes and permissions from
`@kr/contracts`.

## Operations

| Operation      | Route                     | Authorisation                                                                       |
| -------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `listJobs`     | `GET /v1/jobs`            | signed in; visibility in the query (`jobs.read_all`, or an active grant); never 403 |
| `getJobFacets` | `GET /v1/jobs/facets`     | same visibility as `listJobs`                                                       |
| `createJob`    | `POST /v1/jobs`           | global `jobs.create`; idempotent with `Idempotency-Key`                             |
| `getJob`       | `GET /v1/jobs/{jobId}`    | job capability `job.read` (404 when none); ETag = job version                       |
| `updateJob`    | `PATCH /v1/jobs/{jobId}`  | `job.edit`; `If-Match` = job version                                                |
| `deleteJob`    | `DELETE /v1/jobs/{jobId}` | `job.delete` (admin, kr_admin); `If-Match` = job version; archive = soft delete     |

## Audit actions

Written in the same transaction as the change; `changes` holds changed fields only (`{from, to}`, API field names).

| Action         | Entity (`entity_type` / `entity_id`) | `changes`                                                                                                                                                                                    |
| -------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job.created`  | `job` / job id                       | `jobNumber`, `address`, `clientName`, `subdivisionType` (`from: null`)                                                                                                                       |
| `job.updated`  | `job` / job id                       | any of `jobNumber`, `address`, `clientName`, `subdivisionType`, `approvalDate`, `approvalExpiry`, `conformedDate`, `conformedMethod`, `conformedFileId`, `conformedStampText`, `outcomeDate` |
| `job.archived` | `job` / job id                       | `archived: {from: false, to: true}`                                                                                                                                                          |

## Behaviour worth knowing

- Visibility: a job the caller cannot see (no grant, pending/revoked grant, archived) is 404, never 403.
- Version: every write to a job or to one of its checkpoints bumps `jobs.version` (the ETag of `getJob`); a request that
  changes nothing writes nothing (no bump, no audit) but still checks `If-Match`.
- Fee proposal (checkpoint 1.0): without `fee_proposal.view` (staff, architect) its note, decision, paid record and files
  are withheld, it does not count in the package `fileCount`, and its decision does not raise the "Client declined" alert.
- Manual conformed date: method `manual`, reading provenance cleared, outcome date = conformed + 90 days unless sent.
- Facets: status counts, "waiting on client" and "need attention" cover every visible job; `typeCounts` are within the
  status filter (key `""` = all types; keys are the subdivision type names).
- Summaries for the list are computed in the API from three reads (jobs, states, current conditions); revisit above the
  2,000-job design size (PRODUCT_SPEC §14).
