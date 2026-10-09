#!/usr/bin/env node
// Prints the changed source files of a package that its Stryker config would mutate, comma-separated.
//
// CI passes the PR's changed files to `stryker run --mutate`, which REPLACES the config's `mutate` globs. Without
// this filter, http/data files (covered by integration tests, which the command runner does not run) would be
// mutated against unit tests only and fail the break threshold on almost every API PR.
//
// Usage: node scripts/ci/mutation-targets.mjs <packageDir> [changedFile ...]   (paths relative to packageDir)
import { existsSync } from "node:fs";
import { join, matchesGlob, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [pkgDir, ...changed] = process.argv.slice(2);
if (!pkgDir) {
  process.stderr.write("usage: mutation-targets.mjs <packageDir> [changedFile ...]\n");
  process.exit(2);
}
const configPath = resolve(pkgDir, "stryker.config.mjs");
if (!existsSync(configPath)) process.exit(0);

const { default: config } = await import(pathToFileURL(configPath).href);
const patterns = Array.isArray(config.mutate) ? config.mutate : [];
const include = patterns.filter((p) => !p.startsWith("!"));
const exclude = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));

const targets = changed
  .map((f) => f.trim())
  .filter(Boolean)
  .filter((f) => existsSync(join(pkgDir, f)))
  .filter((f) => include.some((g) => matchesGlob(f, g)) && !exclude.some((g) => matchesGlob(f, g)));

process.stdout.write(targets.join(","));
