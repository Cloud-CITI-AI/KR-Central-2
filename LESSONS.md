<!-- managed-by: agentic-playbook v1.0.0 | header is managed; entries below the marker are repo-owned and APPEND-ONLY (CI rejects edits to existing entries) -->
# LESSONS.md

Append an entry whenever a human corrects, reverts, or substantially rewrites agent output, or a review comment points out something the agent should have known. Agents add entries (rule A10); humans may add them too. Do not edit or delete existing entries; to mark one resolved, append a new entry with `Supersedes:`.

Entry format (YAML front block inside a fenced code block, one per entry, newest at the bottom):

```yaml
id: L-<YYYYMMDD>-<short-slug>          # unique
date: 2026-10-06
trigger: review-comment | correction | revert | rewrite | incident | eval-failure
agent: claude-code/<model> | copilot | cursor | codex | other
pr: "#123"
area: <path glob or domain, e.g. services/api/src/billing/**>
what_happened: >-
  One or two sentences, factual.
root_cause: missing-context | ignored-rule | ambiguous-brief | wrong-pattern | tool-limitation | unknown
existing_rule: <rule ID if a rule existed and was not followed, else none>
proposed_rule: >-
  Imperative, verifiable sentence an agent could follow, or "none".
check: <how compliance could be checked automatically, or "manual">
severity: low | medium | high | security
supersedes: <id or none>
```

<!-- ENTRIES-START -->

```yaml
id: L-20261009-briefs-cite-spec
date: 2026-10-09
trigger: review-comment
agent: claude-code/claude-opus-5-5
pr: "n/a (scaffold plan review)"
area: docs/plan/**
what_happened: >-
  Work-package briefs paraphrased UI texts, limits and rules (rate limits, banner text, zip name, note visibility,
  conformed-date order) and eleven of them contradicted PRODUCT_SPEC.
root_cause: wrong-pattern
existing_rule: none
proposed_rule: >-
  Briefs cite PRODUCT_SPEC/DATA_MODEL sections for exact texts, numbers and rules instead of restating them; a quoted
  value must be copied verbatim from the spec.
check: manual (plan review); docs/plan/work-packages.json is the single source rendered into every brief
severity: medium
supersedes: none
```

```yaml
id: L-20261009-migrator-credentials-scope
date: 2026-10-09
trigger: review-comment
agent: claude-code/claude-opus-5-5
pr: "n/a (scaffold plan review)"
area: infra/**
what_happened: >-
  The plan ran migrations as a Railway pre-deploy command of the api service, which shares the api's variables and
  would have given the running API the DDL role.
root_cause: missing-context
existing_rule: DB-6
proposed_rule: >-
  Only a dedicated one-purpose service or job may hold migrator credentials; long-running services get the app role
  only.
check: infra/railway/services/*.json + docs/deploy/railway.md variable table (MIGRATION_DATABASE_URL on migrate only)
severity: security
supersedes: none
```

```yaml
id: L-20261009-workflow-chaining
date: 2026-10-09
trigger: review-comment
agent: claude-code/claude-opus-5-5
pr: "n/a (scaffold plan review)"
area: .github/workflows/**
what_happened: >-
  deploy.yml listened for `release: published`, but release-please creates releases with GITHUB_TOKEN, which never
  triggers other workflows, and the image digests were uploaded after the release existed.
root_cause: tool-limitation
existing_rule: none
proposed_rule: >-
  Chain dependent workflows with workflow_call and `needs`, never through events created with GITHUB_TOKEN.
check: manual (CI review)
severity: high
supersedes: none
```

```yaml
id: L-20261009-ci-matrix-complete
date: 2026-10-09
trigger: review-comment
agent: claude-code/claude-opus-5-5
pr: "n/a (scaffold plan review)"
area: .github/workflows/ci.yml
what_happened: >-
  Two workspace packages (storage, mock-idp) were missing from the CI matrix, so their work packages would have
  merged ungated.
root_cause: ignored-rule
existing_rule: none
proposed_rule: >-
  Every workspace package is in the CI matrix.
check: scripts/ci/check-ci-matrix.mjs (run by root `pnpm lint`)
severity: medium
supersedes: none
```
