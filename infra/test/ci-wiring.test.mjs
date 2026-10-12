/**
 * ADR-0008 / definition of done: the infra tests run, and every Dockerfile builds, on every PR before a release. Both are
 * jobs of ci.yml and part of the required `ci / verify` aggregate (a job outside `needs` could fail without blocking).
 *
 *   node --test infra/test/ci-wiring.test.mjs
 *
 * Only Node built-ins (infra/ is not a pnpm workspace package).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const ci = read(".github/workflows/ci.yml");

/** The text of one top-level job (two-space indent) of a workflow. */
function job(workflow, name) {
  const start = workflow.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  assert.notEqual(start, -1, `ci.yml has a job ${name}`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[\w-]+:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

const dockerfiles = execFileSync("git", ["ls-files", "--", "Dockerfile", "**/Dockerfile"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .sort();

test("the repository has Dockerfiles to build", () => {
  assert.ok(dockerfiles.length >= 6, dockerfiles.join(", "));
});

test("root package.json has a test:infra script that runs every infra test directory", () => {
  const script = JSON.parse(read("package.json")).scripts["test:infra"];
  assert.equal(typeof script, "string", "scripts.test:infra");
  for (const dir of ["infra/railway", "infra/clamav/test", "infra/test"]) assert.ok(script.includes(dir), dir);
});

test("ci.yml has an infra job that runs `pnpm test:infra`", () => {
  assert.match(job(ci, "infra"), /^\s+- run: pnpm test:infra\s*$/m);
});

test("ci.yml builds every Dockerfile with push: false, using an action pinned by full SHA", () => {
  const images = job(ci, "images");
  const built = [...images.matchAll(/^\s+- dockerfile:\s*(\S+)\s*$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(built, dockerfiles, "the matrix lists exactly the Dockerfiles of the repository");
  assert.match(images, /uses: docker\/setup-buildx-action@[0-9a-f]{40} # v/);
  assert.match(images, /uses: docker\/build-push-action@[0-9a-f]{40} # v/);
  assert.match(images, /^\s+push: false\s*$/m);
  assert.doesNotMatch(images, /push: true|registry:|docker\/login-action/);
});

test("the required ci / verify aggregate waits for the infra and images jobs", () => {
  const needs = /^ {4}needs: \[([^\]]*)\]/m
    .exec(job(ci, "verify"))?.[1]
    .split(",")
    .map((s) => s.trim());
  assert.ok(needs, "verify has a needs list");
  for (const name of ["infra", "images"]) assert.ok(needs.includes(name), `verify needs ${name}`);
});
