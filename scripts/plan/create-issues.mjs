#!/usr/bin/env node
// Creates one GitHub issue per work package (playbook: every agent task starts from an issue) using the `gh` CLI.
// Dry run by default; pass --apply once the repository exists on GitHub. Labels: agent-task, risk:<tier>, wave:<n>.
//   node scripts/plan/create-issues.mjs [--apply] [--repo owner/name] [WP-01 ...]
import { execFileSync } from "node:child_process";
import { loadPlan, renderBrief } from "./lib.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const repoIdx = args.indexOf("--repo");
const repo = repoIdx >= 0 ? args[repoIdx + 1] : undefined;
const only = args.filter((a) => /^WP-\d+$/.test(a));

const plan = loadPlan();
for (const wp of plan.work_packages.filter((w) => only.length === 0 || only.includes(w.id))) {
  const title = `${wp.id}: ${wp.title}`;
  const body = `${renderBrief(plan, wp)}\n\n---\nRendered from docs/plan/work-packages.json. Commit trailer once this issue exists: \`Refs: #<this issue>\` (plus \`Refs: ${wp.id}\`).`;
  const labels = ["agent-task", `risk:${wp.risk_tier.toLowerCase()}`, `wave:${wp.wave}`];
  const ghArgs = ["issue", "create", "--title", title, "--body", body, ...labels.flatMap((l) => ["--label", l])];
  if (repo) ghArgs.push("--repo", repo);
  if (apply) {
    const url = execFileSync("gh", ghArgs, { encoding: "utf8" }).trim();
    process.stdout.write(`${wp.id} → ${url}\n`);
  } else {
    process.stdout.write(
      `[dry-run] gh issue create --title "${title}" ${labels.map((l) => `--label ${l}`).join(" ")} (${body.length} chars)\n`,
    );
  }
}
