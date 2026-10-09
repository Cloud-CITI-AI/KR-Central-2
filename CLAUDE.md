@AGENTS.md

<!-- managed-by: agentic-playbook v1.0.0 | source: templates/project/CLAUDE.md -->

## Claude Code specifics

- C1. Use plan mode for any task that touches more than 3 files, any migration, or any risk tier High path. Post the plan before editing.
- C2. Protected paths (rule X1) are blocked by `.claude/hooks/protect-instruction-files.sh`. If the hook blocks you, do not try another route (Bash, sed, mv, git); report what you needed and why.
- C3. Do not ask the user to disable the sandbox, add `--dangerously-skip-permissions`, or widen `permissions.allow`. If a command fails in the sandbox, report the failure.
- C4. Use subagents for broad searches and independent test investigations; keep the main context for the change itself.
- C5. Your auto memory is machine-local and invisible to the team. Durable lessons go in `LESSONS.md` (rule A10), never only in memory.
- C6. Before declaring done, run the `verify` command and paste its summary lines (pass/fail counts, diff coverage) into the PR evidence section.
