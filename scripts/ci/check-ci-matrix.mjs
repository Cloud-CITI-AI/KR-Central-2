#!/usr/bin/env node
// Fails when a workspace package is missing from the CI matrix in .github/workflows/ci.yml (an ungated package
// would merge without lint/tests/coverage). Run by `pnpm lint` at the repo root.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const workspaceDirs = ["apps", "services", "packages"].flatMap((group) =>
  existsSync(join(root, group))
    ? readdirSync(join(root, group), { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(root, group, d.name, "package.json")))
        .map((d) => `${group}/${d.name}`)
    : [],
);

const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
const match = /^\s*packages:\s*'(\[.*\])'\s*$/m.exec(ci);
if (!match) {
  process.stderr.write("check-ci-matrix: could not find the `packages:` matrix in .github/workflows/ci.yml\n");
  process.exit(1);
}
const matrix = new Set(JSON.parse(match[1]));
const missing = workspaceDirs.filter((d) => !matrix.has(d));
const unknown = [...matrix].filter((d) => !workspaceDirs.includes(d));
if (missing.length || unknown.length) {
  if (missing.length) process.stderr.write(`CI matrix is missing workspace packages: ${missing.join(", ")}\n`);
  if (unknown.length) process.stderr.write(`CI matrix lists unknown packages: ${unknown.join(", ")}\n`);
  process.exit(1);
}
process.stdout.write(`check-ci-matrix: ${workspaceDirs.length} workspace packages, all gated by CI.\n`);
