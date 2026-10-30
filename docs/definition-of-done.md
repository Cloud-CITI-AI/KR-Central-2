<!-- managed-by: agentic-playbook v1.0.0 -->

# Definition of Ready and Definition of Done

## Definition of Ready (an issue may be started, by a human or an agent, only when all are true)

| #   | Criterion                                                               | Checked by                 |
| --- | ----------------------------------------------------------------------- | -------------------------- |
| R1  | Goal states the user-visible outcome                                    | Issue form required field  |
| R2  | Acceptance criteria are numbered and each is testable                   | Triage reviewer            |
| R3  | Out-of-scope is stated                                                  | Issue form required field  |
| R4  | Risk tier assigned (Low/Medium/High)                                    | Issue form required field  |
| R5  | Permissions for the task are explicit (deps, API, migration, snapshots) | Agent task form checkboxes |
| R6  | Dependencies, owners and any needed ADR are linked                      | Triage reviewer            |
| R7  | Estimated diff ≤ 400 lines, or split into sub-issues                    | Triage reviewer            |

## Definition of Done (a PR may merge only when all are true)

| #   | Criterion                                                                          | Checked by                      |
| --- | ---------------------------------------------------------------------------------- | ------------------------------- |
| D1  | Every acceptance criterion maps to a test or attached screenshot                   | Reviewer (PR evidence)          |
| D2  | Required checks green: `ci / verify`, `security / scan`, `playbook-guard`          | Ruleset                         |
| D3  | Diff coverage ≥ 80%; mutation score on changed domain files ≥ 60%                  | CI                              |
| D4  | No new lint/type/security warnings; no skipped tests without linked issue          | CI                              |
| D5  | Docs, API schema, CHANGELOG (Unreleased) updated where behaviour changed           | Reviewer                        |
| D6  | Rollout and rollback described; flag or canary for Medium/High                     | Reviewer                        |
| D7  | Migrations follow expand/contract and passed the migration linter                  | CI + reviewer                   |
| D8  | PR template complete, AI disclosure accurate, `agent-authored` label if applicable | `playbook-guard`                |
| D9  | No approval required (DECISIONS_LOG, 30 Oct 2026); the launching human merges      | Launching human                 |
| D10 | Any human correction during review recorded in `LESSONS.md`                        | Reviewer prompt in PR checklist |

## Done-done (after merge)

| #   | Criterion                                                                                        | Checked by               |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------ |
| P1  | Deployed to production or behind a flag within 1 business day of merge                           | DORA lead-time dashboard |
| P2  | No SLO alert attributable to the change within 24 h, else rollback/fix-forward and incident note | On-call                  |
