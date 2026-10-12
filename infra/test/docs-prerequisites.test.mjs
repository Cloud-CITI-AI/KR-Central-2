/**
 * Operator prerequisites that cannot be seen from the code, so the docs must state them (and keep stating them):
 *  - the required `security / scan` check needs GitHub Code Security on a private repository, with the fallback decision;
 *  - the `staging` and `production` GitHub Environments are limited to deployments from `main` (SE-2), and that rule is
 *    sufficient because deploy.yml only runs with the ref `refs/heads/main`: release.yml (push to main) calls it, and a
 *    manual run is started from main with the tag as an input.
 *
 *   node --test infra/test/docs-prerequisites.test.mjs
 *
 * Only Node built-ins (infra/ is not a pnpm workspace package).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\s+/g, " ");
const guide = read("docs/deploy/railway.md");
const adr = read("docs/adr/0008-railway-hosting-and-delivery.md");
const runbook = read("docs/runbooks/deploy-and-rollback.md");

test("the guide and ADR-0008 state that security / scan needs GitHub Code Security on a private repository", () => {
  for (const [name, text] of [
    ["railway.md", guide],
    ["ADR-0008", adr],
  ]) {
    assert.match(text, /GitHub Code Security/, `${name}: names the licence`);
    assert.match(text, /CodeQL/, `${name}: CodeQL`);
    assert.match(text, /dependency-review/i, `${name}: dependency review`);
    assert.match(text, /security \/ scan/, `${name}: the required check`);
  }
  assert.match(
    guide,
    /GitHub Code Security.{0,1500}(instead|fallback|if (it is|the organi[sz]ation is) not)/i,
    "fallback decision",
  );
});

test("the guide limits the staging and production environments to main and says why", () => {
  assert.match(
    guide,
    /Deployment branches and tags for `staging` and `production`:?\*\* in each environment.{0,200}branch `main`/i,
  );
  assert.match(guide, /refs\/heads\/main/);
  assert.match(guide, /no `v\*` tag pattern|does not need a `v\*` tag pattern/i);
});

test("ADR-0008 (SE-2) and the deploy runbook state the main-only deployment rule", () => {
  assert.match(adr, /SE-2[^]*deployment branches[^.]*`main`/i);
  assert.match(runbook, /accept deployments from `main` only \(their Deployment branches and tags rule\)/);
  assert.match(runbook, /Use workflow from[^.]*`main`/i);
});

test("deploy.yml can only run on main: workflow_call from the push-to-main release.yml, or a manual run", () => {
  const deploy = readFileSync(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const release = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
  const triggers = /^on:\n((?: {2}.*\n|\n)+)/m.exec(deploy)?.[1] ?? "";
  assert.deepEqual(
    [...triggers.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]),
    ["workflow_call", "workflow_dispatch"],
  );
  assert.match(release, /^on:\n {2}push:\n {4}branches: \[main\]\n/m);
  assert.doesNotMatch(release, /^ {4}tags:/m, "no tag trigger");
});
