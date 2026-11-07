# Feature flags (playbook CF-4)

Flags are read through OpenFeature (environment-variable provider) — never with ad-hoc `process.env` checks.

| Flag                  | Env var                       | Default | Owner              | Review / removal date | Purpose                                                                                                                                                                                                                                                                                                    |
| --------------------- | ----------------------------- | ------- | ------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-stamp-reading`    | `FEATURE_AI_STAMP_READING`    | off     | KR Surveys (Craig) | 2027-04-01            | Claude vision reads the conformance stamp date (ADR-0010). Requires `ANTHROPIC_API_KEY` on the worker.                                                                                                                                                                                                     |
| `entra-guest-invites` | `FEATURE_ENTRA_GUEST_INVITES` | off     | KR Surveys IT      | 2027-04-01            | Granting access sends an Entra B2B invitation via Microsoft Graph (ADR-0014). Requires `User.Invite.All` admin consent.                                                                                                                                                                                    |
| `teams-file-sync`     | `FEATURE_TEAMS_FILE_SYNC`     | off     | KR Surveys (Craig) | 2027-06-30            | The Teams/SharePoint integration exists: Admin → Teams, the job panel, the worker's Graph client (ADR-0015). Read by `api` and `worker`; the worker also needs `TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID` and `TEAMS_CLIENT_SECRET`. Whether files are copied is the `sync_enabled` switch on the settings page. |

Adding a flag: add a row here (owner + date), add the env var to the service config schema and `.env.example`, and
default it off in production.
