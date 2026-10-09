#!/usr/bin/env bash
# managed-by: agentic-playbook v1.0.0
# PreToolUse hook: blocks agent edits to protected paths (rule X1) and existing LESSONS.md entries.
# Exit 2 = block; stderr is shown to the agent. Exit 0 = allow.
# Defence in depth only: CODEOWNERS, rulesets and the playbook-guard workflow are the real controls.
set -euo pipefail

input="$(cat)"
tool="$(printf '%s' "$input" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_name",""))')"

PROTECTED_REGEX='(^|/)(AGENTS\.md|CLAUDE\.md|CODEOWNERS|renovate\.json)$|(^|/)\.github/|(^|/)\.claude/|(^|/)\.cursor/|(^|/)infra/prod/'

block() {
  echo "BLOCKED by playbook rule X1: '$1' is a protected path. Do not retry via another tool. Describe the change you need under 'Rule proposal' in the PR description." >&2
  exit 2
}

if [[ "$tool" == "Bash" ]]; then
  cmd="$(printf '%s' "$input" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))')"
  # Heuristic: a write-capable verb plus a protected path in the same command.
  if printf '%s' "$cmd" | grep -Eq '(>|>>|\btee\b|\bsed\b.*-i|\bperl\b.*-i|\bmv\b|\bcp\b|\brm\b|\bln\b|\btruncate\b|git (checkout|restore|rm|mv))' \
     && printf '%s' "$cmd" | grep -Eq '(AGENTS\.md|CLAUDE\.md|CODEOWNERS|renovate\.json|\.github/|\.claude/|\.cursor/|infra/prod/|LESSONS\.md)'; then
    # Allow a pure append to LESSONS.md (cat >> LESSONS.md / echo >> LESSONS.md)
    if printf '%s' "$cmd" | grep -Eq '>>[[:space:]]*\.?/?LESSONS\.md' && ! printf '%s' "$cmd" | grep -Eq '(AGENTS\.md|CLAUDE\.md|CODEOWNERS|\.github/|\.claude/|\.cursor/|infra/prod/)'; then
      exit 0
    fi
    block "$cmd"
  fi
  exit 0
fi

path="$(printf '%s' "$input" | python3 -c 'import sys,json; t=json.load(sys.stdin).get("tool_input",{}); print(t.get("file_path") or t.get("notebook_path") or "")')"
rel="${path#"${CLAUDE_PROJECT_DIR:-$PWD}"/}"

if printf '%s' "$rel" | grep -Eq "$PROTECTED_REGEX"; then
  block "$rel"
fi

# LESSONS.md: Write (full overwrite) is blocked; Edit is allowed only if old_string is empty-ish append at the end.
if printf '%s' "$rel" | grep -Eq '(^|/)LESSONS\.md$'; then
  if [[ "$tool" == "Write" ]]; then
    block "$rel (use an append, not a full rewrite)"
  fi
  # For Edit/MultiEdit, CI (validate-lessons.py) verifies existing entries are unchanged.
fi
exit 0
