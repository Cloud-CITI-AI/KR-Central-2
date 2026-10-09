#!/usr/bin/env bash
# PR size gate (N3, A1). Env: BASE_SHA, HEAD_SHA, LABELS (comma-separated)
# Human PRs: warn > 400, fail > 800. Agent PRs (label agent-authored): fail > 400.
# Label "size-exception" (CODEOWNER-applied) downgrades failure to warning.
set -euo pipefail
: "${BASE_SHA:?}"; : "${HEAD_SHA:?}"; LABELS=",${LABELS:-},"
EXCLUDE='(^|/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|uv\.lock|poetry\.lock|Cargo\.lock)$|(^|/)(src/gen|__generated__|generated)/|\.snap$|-snapshots/|\.min\.(js|css)$|(^|/)openapi\.json$|(^|/)LESSONS\.md$|(^|/)CHANGELOG\.md$'
total=0
while read -r add del path; do
  [[ "$add" == "-" ]] && continue   # binary
  if [[ "$path" =~ $EXCLUDE ]]; then continue; fi
  total=$(( total + add + del ))
done < <(git diff --numstat "$BASE_SHA" "$HEAD_SHA")
echo "Changed lines (excluding lockfiles/generated/snapshots): $total"
agent=false; [[ "$LABELS" == *",agent-authored,"* ]] && agent=true
exception=false; [[ "$LABELS" == *",size-exception,"* ]] && exception=true
limit=800; $agent && limit=400
if (( total > limit )); then
  if $exception; then echo "::warning::PR is $total lines (limit $limit) — allowed by size-exception label"; exit 0; fi
  echo "::error::PR is $total changed lines; limit is $limit for this PR type. Split it (see docs/05 §5.4)."; exit 1
elif (( total > 400 )); then
  echo "::warning::PR is $total changed lines; aim for ≤ 400."
fi
