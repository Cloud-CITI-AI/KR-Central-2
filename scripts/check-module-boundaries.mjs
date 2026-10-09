#!/usr/bin/env node
// Module boundary check for services/api (ADR-0004, playbook ST-2).
// Rule: code in src/modules/<a>/** may import another module <b> ONLY through its public entry
// src/modules/<b>/index.ts. Deep imports into another module's http/, domain/ or data/ fail the lint.
// Usage: node scripts/check-module-boundaries.mjs <modules-dir>
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "src/modules");
if (!existsSync(root)) {
  console.log(`module boundaries: ${relative(process.cwd(), root)} does not exist yet — nothing to check`);
  process.exit(0);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

const importRe =
  /(?:import|export)\s[^"']*?from\s+["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
const violations = [];
for (const file of walk(root)) {
  const own = relative(root, file).split(sep)[0];
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(importRe)) {
    const spec = m[1] ?? m[2];
    const target = resolve(dirname(file), spec);
    const rel = relative(root, target);
    if (rel.startsWith("..")) continue; // outside modules/ (platform, shared) — allowed
    const [mod, ...rest] = rel.split(sep);
    if (mod === own) continue;
    const isPublicEntry = rest.length === 1 && /^index(\.js|\.ts)?$/.test(rest[0]);
    const isModuleDir = rest.length === 0;
    if (!isPublicEntry && !isModuleDir)
      violations.push(`${relative(process.cwd(), file)} → ${spec} (import modules/${mod} via its index.ts)`);
  }
}
if (violations.length) {
  console.error("Module boundary violations:\n  " + violations.join("\n  "));
  process.exit(1);
}
console.log("module boundaries: ok");
