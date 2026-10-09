#!/usr/bin/env node
// Validates docs/plan/work-packages.json and that WORK_PACKAGES.md is freshly rendered (after Prettier).
// Rules: every brief section present (playbook task-brief template); risk tier valid; ≤ max_concurrent_per_wave WPs
// per wave; dependencies only on earlier waves; owned paths disjoint within a wave; no protected paths owned.
import { readFileSync } from "node:fs";
import { PLAN_MD, loadPlan } from "./lib.mjs";
import { renderFormatted } from "./render-work-packages.mjs";

const plan = loadPlan();
const errors = [];
const wps = plan.work_packages;
const byId = new Map(wps.map((w) => [w.id, w]));
const REQUIRED = [
  "id",
  "title",
  "wave",
  "risk_tier",
  "risk_reason",
  "scope",
  "package",
  "owned_paths",
  "goal",
  "read_first",
  "deliverables",
  "pr_stack",
  "acceptance",
  "out_of_scope",
  "verify_cmds",
];
const PROTECTED = [
  /(^|\/)AGENTS\.md$/,
  /(^|\/)CLAUDE\.md$/,
  /^\.github\//,
  /^\.claude\//,
  /^CODEOWNERS$/,
  /^renovate\.json$/,
  /^scripts\/playbook\//,
];

for (const w of wps) {
  for (const k of REQUIRED) {
    const v = w[k];
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0))
      errors.push(`${w.id ?? "?"}: missing ${k}`);
  }
  if (!["Low", "Medium", "High"].includes(w.risk_tier)) errors.push(`${w.id}: invalid risk tier ${w.risk_tier}`);
  for (const d of w.depends_on ?? []) {
    const dep = byId.get(d);
    if (!dep) errors.push(`${w.id}: unknown dependency ${d}`);
    else if (dep.wave >= w.wave) errors.push(`${w.id} (wave ${w.wave}) depends on ${d} (wave ${dep.wave})`);
  }
  for (const p of w.owned_paths ?? [])
    if (PROTECTED.some((re) => re.test(p))) errors.push(`${w.id}: owns protected path ${p}`);
}

const waves = new Map();
for (const w of wps) waves.set(w.wave, [...(waves.get(w.wave) ?? []), w]);
const base = (p) => (p.endsWith("/**") ? p.slice(0, -2) : p);
const overlaps = (a, b) => {
  const A = base(a);
  const B = base(b);
  return A === B || (a.endsWith("/**") && B.startsWith(A)) || (b.endsWith("/**") && A.startsWith(B));
};
for (const [wave, list] of waves) {
  if (list.length > plan.max_concurrent_per_wave)
    errors.push(`wave ${wave} has ${list.length} WPs (max ${plan.max_concurrent_per_wave})`);
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      for (const a of list[i].owned_paths)
        for (const b of list[j].owned_paths)
          if (overlaps(a, b)) errors.push(`wave ${wave}: ${list[i].id} ${a} overlaps ${list[j].id} ${b}`);
}

// Stale Markdown check: the file must equal the Prettier-formatted rendering of the JSON.
if ((await renderFormatted(plan)) !== readFileSync(PLAN_MD, "utf8"))
  errors.push("docs/plan/WORK_PACKAGES.md is stale: run `node scripts/plan/render-work-packages.mjs`");

if (errors.length) {
  for (const e of errors) process.stderr.write(`check-work-packages: ${e}\n`);
  process.exit(1);
}
process.stdout.write(`check-work-packages: ${wps.length} work packages in ${waves.size} waves — OK\n`);
