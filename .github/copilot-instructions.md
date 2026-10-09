<!-- managed-by: agentic-playbook v1.0.0 | source: templates/project/.github/copilot-instructions.md -->

# Copilot instructions

All coding rules live in the root `AGENTS.md` and package `AGENTS.md` files, which Copilot reads directly. Do not duplicate them here.

## When reviewing a pull request

Comment only on substantive issues, ordered by severity. For each, cite the file and line and, where one applies, the rule ID from `AGENTS.md` or the playbook.

1. Security: missing input validation (A4), missing authorisation check on a handler, raw SQL string building, secrets or personal data in logs (A6), new external hosts (X7), unsafe HTML rendering.
2. Correctness: unhandled errors or promise rejections (A5), off-by-one or null cases not covered by tests, migrations that are not expand/contract.
3. Tests: behaviour change without a test (A2), assertions that cannot fail, skipped tests (X4), mocks of the database in repository tests.
4. Scope: diff over 400 changed lines (A1), unrelated changes, edits to protected paths (X1).
5. PR evidence: empty or unverifiable evidence fields (X8).
   Do not comment on formatting that the linter enforces. Your review is advisory and never counts as an approval.
