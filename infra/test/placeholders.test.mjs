/**
 * The `playbook-guard` required check ("No unfilled template placeholders") must be able to pass: its own grep may not
 * match the workflow file that holds it, nor legitimate examples in the docs. This runs exactly the workflow's `git grep`
 * (extracted from the workflow text) against the repository, and against a scratch repository with a real placeholder to
 * prove the check is not vacuous.
 *
 *   node --test infra/test/placeholders.test.mjs
 *
 * Only Node built-ins (infra/ is not a pnpm workspace package).
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("../../", import.meta.url).pathname;
const workflow = readFileSync(join(root, ".github/workflows/playbook-guard.yml"), "utf8");
const command = workflow.match(/^\s*if (git grep -nE .+); then$/m)?.[1];

const run = (cwd) => spawnSync("sh", ["-c", command], { cwd, encoding: "utf8" });

test("the workflow step runs a git grep for placeholders", () => {
  assert.ok(command, "found the `git grep` line of the placeholder step in playbook-guard.yml");
});

test("the placeholder grep finds nothing in the repository (exit 1 means no match)", () => {
  const result = run(root);
  assert.equal(result.status, 1, `unexpected placeholder match:\n${result.stdout}${result.stderr}`);
});

test("the placeholder grep still catches each placeholder kind in a scratch repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "placeholders-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    git("init", "-q");
    for (const text of ["<<" + "FILL: owner>>", "<<PLAYBOOK" + "_SHA>>", "<" + "org>/repo"]) {
      writeFileSync(join(dir, "doc.md"), `value ${text}\n`);
      git("add", "doc.md");
      const result = run(dir);
      assert.equal(result.status, 0, `${text} was not detected`);
      assert.match(result.stdout, /doc\.md:1:/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
