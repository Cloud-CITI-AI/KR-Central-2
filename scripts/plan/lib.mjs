// Shared helpers for the work-package plan. Source of truth: docs/plan/work-packages.json.
// docs/plan/WORK_PACKAGES.md and each agent brief are rendered from it (render-work-packages.mjs).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const PLAN_JSON = `${ROOT}docs/plan/work-packages.json`;
export const PLAN_MD = `${ROOT}docs/plan/WORK_PACKAGES.md`;

export function loadPlan() {
  return JSON.parse(readFileSync(PLAN_JSON, "utf8"));
}

const PERMISSION_LABELS = {
  runtime_dependency: "May add a runtime dependency",
  api_contract: "May change the public API contract",
  migration: "May add a database migration",
  visual_snapshots: "May create/update visual snapshots",
};

export function permissionLines(wp) {
  const p = wp.permissions ?? {};
  const lines = Object.entries(PERMISSION_LABELS).map(([k, label]) => `${label}: ${p[k] ?? "no"}`);
  if (p.note) lines.push(`Note: ${p.note}`);
  return lines;
}

const numbered = (items) => items.map((x, i) => `${i + 1}. ${x}`);

/** The complete, self-contained brief handed to a coding agent (plain text). */
export function renderBrief(plan, wp) {
  const out = [];
  out.push(`COMMON RULES (mandatory; also in docs/plan/WORK_PACKAGES.md §0):`);
  out.push(...plan.common_rules.map((r) => `- ${r}`));
  out.push("");
  out.push(`WORK PACKAGE ${wp.id} — ${wp.title}`);
  out.push(`Risk tier: ${wp.risk_tier} (${wp.risk_reason}).`);
  if (wp.risk_tier === "High") out.push(plan.high_tier_note);
  out.push(`Target: ${wp.package}. Commit scope: ${wp.scope}. Wave ${wp.wave}.`);
  out.push(`Depends on (merged before you start): ${wp.depends_on.length ? wp.depends_on.join(", ") : "nothing"}.`);
  out.push(`Owned paths (edit nothing else): ${wp.owned_paths.join(", ")}`);
  out.push("");
  out.push(`GOAL: ${wp.goal}`);
  out.push("");
  out.push("READ FIRST:");
  out.push(...wp.read_first.map((x) => `- ${x}`));
  out.push("");
  out.push("PLAN OF RECORD (deliverables):");
  out.push(...numbered(wp.deliverables));
  out.push("");
  out.push("PR STACK (in order; each ≤ 400 changed lines and green on its own):");
  out.push(...numbered(wp.pr_stack));
  out.push("");
  out.push("ACCEPTANCE CRITERIA (each maps to a test or a screenshot in the PR):");
  out.push(...numbered(wp.acceptance));
  out.push("");
  out.push("OUT OF SCOPE / MUST NOT CHANGE:");
  out.push(...wp.out_of_scope.map((x) => `- ${x}`));
  out.push("");
  out.push("PERMISSIONS FOR THIS TASK:");
  out.push(...permissionLines(wp).map((x) => `- ${x}`));
  if (wp.hints?.length) {
    out.push("");
    out.push("HINTS:");
    out.push(...wp.hints.map((x) => `- ${x}`));
  }
  out.push("");
  out.push("VERIFY (all must pass):");
  out.push(...wp.verify_cmds.map((x) => `- ${x}`));
  return out.join("\n");
}
