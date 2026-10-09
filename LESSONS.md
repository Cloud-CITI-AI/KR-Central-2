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
