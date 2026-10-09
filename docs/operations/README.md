# Operations

The entry point for whoever runs the KR Subdivision Tracker on Railway: where everything is, what to check, and what to
do when paged. The system: `web` (public), `api`, `worker`, `clamav`, `migrate`, `backup`, Railway Postgres 17 and two
Buckets (`files`, `backups`), in two environments (`staging`, `production`). Business hours are Perth (UTC+8, no daylight
saving); times in the logs are UTC.

## Index

| Need                                | Go to                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| An alert fired                      | [runbooks/README.md](../runbooks/README.md), then the runbook named like the alert                   |
| Alert rules, objectives, dashboards | [alerts](../observability/alerts.md), [slo](../slo.md), [dashboards](../observability/dashboards.md) |
| Release, approve, roll back, freeze | [deploy-and-rollback](../runbooks/deploy-and-rollback.md)                                            |
| First-time set-up, variables, Entra | [deploy/railway.md](../deploy/railway.md)                                                            |
| Backups and the restore drill       | [backup-and-restore](../runbooks/backup-and-restore.md)                                              |
| Rotating a secret                   | [secrets-rotation](../runbooks/secrets-rotation.md)                                                  |
| A security or data incident         | [incident-response](../runbooks/incident-response.md)                                                |
| Nobody can administer               | [first-admin-recovery](../runbooks/first-admin-recovery.md)                                          |
| Feature flags                       | [flags](../flags.md)                                                                                 |
| Why it is built this way            | [ADRs](../adr/), [threat model](../security/threat-model.md)                                         |
| How people use it                   | [user-guide](../user-guide/README.md)                                                                |

## Access an operator needs

Roles, not names; the people are listed in the KR password manager, which also holds every credential below.

| Access                              | For                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Railway project (both environments) | Logs, redeploys, variables, Postgres, Buckets, TCP proxy                         |
| GitHub: Actions and Environments    | Run `deploy`, approve `production`, set `DEPLOYS_FROZEN`, rotate `RAILWAY_TOKEN` |
| Microsoft Entra admin (KR IT)       | App registration secret, Conditional Access, guest invitations, sign-in logs     |
| Password manager                    | Role passwords, bucket keys, tokens, the contact list                            |
| Anthropic console                   | The API key, only while stamp reading is on                                      |

## On-call checklist

**Start of shift** (10 minutes)

- [ ] You can reach the Railway project, GitHub Actions and the password manager. You know who the backup person and the KR owner are.
- [ ] `node infra/railway/scripts/smoke.mjs --base-url https://<web domain>` passes for production.
- [ ] Last night's backup succeeded: `backup` ran after 18:15 UTC and logged `ops_backup_finished`; a `db/nightly/` dump exists for it.
- [ ] No release is half-way: the latest `deploy` run is green, and `DEPLOYS_FROZEN` is what you expect.
- [ ] Open tickets from ticket-level alerts are read; anything older than a week has an owner.
- [ ] Read the handover note of the last shift.

**When you are paged**

1. Acknowledge, write the time (Perth and UTC) and the alert name in the operations log.
2. Open the runbook for that alert. Decide the severity with [incident-response](../runbooks/incident-response.md); level 1 or 2 means you start an incident thread now.
3. Diagnose read-only first, mitigate with the smallest change, confirm every destructive step with a second person in production.
4. Verify recovery (smoke script, the dashboard), then keep watching for 30 minutes.
5. Write the outcome in the operations log; open follow-up tickets; schedule the review for level 1 or 2.

**End of shift:** hand over open incidents, frozen deploys and any temporary change (for example a raised `WORKER_CONCURRENCY`) in writing.

## Routine calendar

| When         | What                                                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily        | Backup ran and succeeded; no alert left unowned                                                                                                                                                                                   |
| Weekly       | Error budget position (slo.md); failed or exhausted scans (`malware-scan-errors` query); the list of admins and disabled users matches KR's intent                                                                                |
| Monthly      | SLO review against slo.md; flags past their review date (`docs/flags.md`); Entra secret and token expiries within 30 days                                                                                                         |
| 90 days      | Rotate every secret ([secrets-rotation](../runbooks/secrets-rotation.md))                                                                                                                                                         |
| Quarterly    | Restore drill with evidence ([backup-and-restore](../runbooks/backup-and-restore.md)); review the accepted risks in ADR-0008; re-check that Railway Buckets still lack versioning and record the date in `docs/deploy/railway.md` |
| Each release | Approve production with the checklist in deploy-and-rollback; watch the smoke watch                                                                                                                                               |

## The operations log

A running record of what happened to the running system: pages, incidents, deploy approvals, rollbacks, freezes, flag
changes, rotations, restore drills, one-off SQL sessions, and who approved what. It is **not** in this repository:
it carries operational facts and evidence, and the repository must never hold secrets or personal data. KR keeps it
in one shared place that the platform team can write to and others can read. Location: `<set by KR before go-live>`.

Each entry: date and time (Perth and UTC), environment, who, what, why, evidence (run URL, tag, key name, ids, hashes),
and the second person for production. Never put a secret, a client name, an address, an email or a file name in it.

```text
2026-01-01 14:05 AWST / 06:05 UTC  production  <name>  Rolled back to v1.2.3 (run <url>)  Reason: api-availability after v1.2.4  Verified: smoke ok, errors stopped 14:21  Second: <name>
```

## Known gaps to keep in view

- Until KR approves an OTLP backend (ADR-0009) there are no metrics alerts: the smoke watch, logs and SQL stand in
  (slo.md). The alert rules are written, not yet enforced.
- The Railway API calls used by the deploy script have not been verified on a live project (`docs/deploy/railway.md`).
- No recovery time objective is set; the first drills measure one.
- `backup` holds the migrator database URL because the code requires it (known discrepancy in `docs/deploy/railway.md`).
