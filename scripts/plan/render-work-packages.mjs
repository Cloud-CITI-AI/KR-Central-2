#!/usr/bin/env node
// Renders docs/plan/WORK_PACKAGES.md from docs/plan/work-packages.json.
//   node scripts/plan/render-work-packages.mjs           write the Markdown
//   node scripts/plan/render-work-packages.mjs --brief WP-07   print one agent brief
//   node scripts/plan/render-work-packages.mjs --json    print [{id, brief, ...}] for an orchestrator
import { writeFileSync } from "node:fs";
import * as prettier from "prettier";
import { PLAN_MD, loadPlan, permissionLines, renderBrief } from "./lib.mjs";

/** Rendered Markdown formatted exactly as `prettier --write` would (so the check can compare byte for byte). */
export async function renderFormatted(plan) {
  const options = (await prettier.resolveConfig(PLAN_MD)) ?? {};
  return prettier.format(renderMarkdown(plan), { ...options, filepath: PLAN_MD });
}

export function renderMarkdown(plan) {
  const wps = plan.work_packages;
  const waves = [...new Set(wps.map((w) => w.wave))].sort((a, b) => a - b);
  const L = [];
  L.push("# Work packages");
  L.push("");
  L.push(
    "<!-- GENERATED from docs/plan/work-packages.json by scripts/plan/render-work-packages.mjs — edit the JSON, then re-render. `node scripts/plan/check-work-packages.mjs` (part of `pnpm lint` and CI) fails when this file is stale. -->",
  );
  L.push("");
  L.push(
    "Delivery plan for the KR Subdivision Tracker, split into work packages (WPs) that coding agents build. Each WP follows the playbook task-brief template (`templates/agent-task-brief.md`): risk tier, goal, context, plan of record, PR stack, acceptance criteria, out of scope, permissions and verification. Review decisions that shaped this plan: `docs/plan/DECISIONS_LOG.md`.",
  );
  L.push("");
  L.push("## 0. Common rules (part of every brief)");
  L.push("");
  plan.common_rules.forEach((r, i) => L.push(`${i + 1}. ${r}`));
  L.push("");
  L.push("## 1. Schedule");
  L.push("");
  L.push(
    `At most ${plan.max_concurrent_per_wave} WPs run at once (playbook docs/10 §10.5: ≤ 3 concurrent agent PRs per launching human). A wave starts when every WP it depends on is merged; WPs in the same wave own disjoint paths (checked by \`scripts/plan/check-work-packages.mjs\`).`,
  );
  L.push("");
  L.push("| Wave | Work packages | Risk tiers |");
  L.push("| ---- | ------------- | ---------- |");
  for (const w of waves) {
    const inWave = wps.filter((x) => x.wave === w);
    L.push(
      `| ${w} | ${inWave.map((x) => `${x.id} ${x.title.split(" (")[0]}`).join("; ")} | ${inWave.map((x) => `${x.id}: ${x.risk_tier}`).join(", ")} |`,
    );
  }
  L.push("");
  L.push("```mermaid");
  L.push("flowchart LR");
  for (const w of wps)
    for (const d of w.depends_on) L.push(`  ${d.replace("-", "")}[${d}] --> ${w.id.replace("-", "")}[${w.id}]`);
  L.push("```");
  L.push("");
  L.push("## 2. Risk tiers and approvals");
  L.push("");
  L.push(`- ${plan.high_tier_note}`);
  L.push(
    "- Medium: no approval; the launching human merges once CI is green; behaviour behind a flag where applicable; rollback stated.",
  );
  L.push("- Low: no approval; the launching human merges once CI is green.");
  L.push("- CODEOWNERS paths decide: touching a High path makes the PR High regardless of the WP's tier.");
  L.push("");
  L.push("## 3. Work packages");
  for (const wp of wps) {
    L.push("");
    L.push(`### ${wp.id} — ${wp.title}`);
    L.push("");
    L.push(`- Risk tier: **${wp.risk_tier}** — ${wp.risk_reason}`);
    L.push(
      `- Wave: ${wp.wave} · Depends on: ${wp.depends_on.length ? wp.depends_on.join(", ") : "—"} · Target: ${wp.package} · Commit scope: \`${wp.scope}\``,
    );
    L.push(`- Owned paths: ${wp.owned_paths.map((p) => `\`${p}\``).join(", ")}`);
    L.push("");
    L.push(`**Goal.** ${wp.goal}`);
    L.push("");
    L.push("**Read first**");
    L.push("");
    for (const x of wp.read_first) L.push(`- ${x}`);
    L.push("");
    L.push("**Plan of record**");
    L.push("");
    wp.deliverables.forEach((x, i) => L.push(`${i + 1}. ${x}`));
    L.push("");
    L.push("**PR stack** (in order, each ≤ 400 changed lines)");
    L.push("");
    wp.pr_stack.forEach((x, i) => L.push(`${i + 1}. ${x}`));
    L.push("");
    L.push("**Acceptance criteria**");
    L.push("");
    wp.acceptance.forEach((x, i) => L.push(`${i + 1}. ${x}`));
    L.push("");
    L.push("**Out of scope / must not change**");
    L.push("");
    for (const x of wp.out_of_scope) L.push(`- ${x}`);
    L.push("");
    L.push("**Permissions**");
    L.push("");
    for (const x of permissionLines(wp)) L.push(`- ${x}`);
    if (wp.hints?.length) {
      L.push("");
      L.push("**Hints**");
      L.push("");
      for (const x of wp.hints) L.push(`- ${x}`);
    }
    L.push("");
    L.push("**Verify**");
    L.push("");
    L.push("```sh");
    for (const x of wp.verify_cmds) L.push(x);
    L.push("```");
  }
  L.push("");
  return L.join("\n");
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const plan = loadPlan();
  const args = process.argv.slice(2);
  if (args[0] === "--brief") {
    const wp = plan.work_packages.find((w) => w.id === args[1]);
    if (!wp) {
      process.stderr.write(`unknown work package ${args[1]}\n`);
      process.exit(2);
    }
    process.stdout.write(renderBrief(plan, wp) + "\n");
  } else if (args[0] === "--json") {
    const out = plan.work_packages.map((wp) => ({
      id: wp.id,
      title: wp.title,
      wave: wp.wave,
      depends_on: wp.depends_on,
      owned_paths: wp.owned_paths,
      brief: renderBrief(plan, wp),
      acceptance: wp.acceptance,
      verify_cmds: wp.verify_cmds,
    }));
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    writeFileSync(PLAN_MD, await renderFormatted(plan));
    process.stdout.write(`wrote ${PLAN_MD}\n`);
  }
}
