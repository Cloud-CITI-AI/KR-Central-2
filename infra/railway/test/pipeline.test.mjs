import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Static checks on the delivery pipeline files (workflows, ignore lists, Dockerfiles). They read the files as text:
 * the real proof is in CI (actionlint, zizmor) and in the first staging release; these tests stop the specific
 * regressions found in QA round 1 from coming back.
 */
const repo = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repo), "utf8");

test("gitleaks: the reviewed false positives are ignored by exact, history-stable fingerprint", () => {
  assert.ok(existsSync(new URL(".gitleaksignore", repo)), ".gitleaksignore exists");
  const lines = read(".gitleaksignore")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));
  assert.equal(lines.length, 6);
  for (const line of lines) assert.match(line, /^[0-9a-f]{40}:[\w./-]+:[\w-]+:\d+$/, line);
  const files = lines.map((l) => l.split(":")[1]).sort();
  assert.deepEqual(files, [
    "apps/web/src/lib/api/client.test.ts",
    "apps/web/src/lib/api/upload.test.ts",
    "apps/web/src/lib/bff/proxy.test.ts",
    "apps/web/src/lib/bff/proxy.test.ts",
    "packages/storage/src/s3.ts",
    "services/ops/test/support.ts",
  ]);
  assert.ok(!existsSync(new URL(".gitleaks.toml", repo)), "no path-wide allowlist next to the fingerprints");
});

// ---- deploy.yml (BUG 2 and BUG 3) -----------------------------------------------------------------------------------

/** The text of each step of a job in a workflow file (steps start with `      - ` at the job's step indent). */
function jobSteps(workflow, job) {
  const start = workflow.search(new RegExp(`^  ${job}:\\s*$`, "m"));
  assert.notEqual(start, -1, `job ${job}`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[\w-]+:\s*$/m);
  const body = next === -1 ? rest : rest.slice(0, next);
  const stepsAt = body.search(/^ {4}steps:\s*$/m);
  return body
    .slice(stepsAt)
    .split(/^(?= {6}- )/m)
    .slice(1);
}
const jobTimeout = (workflow, job) => {
  const start = workflow.search(new RegExp(`^  ${job}:\\s*$`, "m"));
  const header = workflow.slice(start).split(/^ {4}steps:/m)[0];
  return Number(/^ {4}timeout-minutes:\s*(\d+)/m.exec(header)?.[1]);
};
const stepNamed = (steps, pattern) => {
  const found = steps.filter((s) => pattern.test(s.split("\n")[0] + (/name:.*/.exec(s)?.[0] ?? "")));
  assert.equal(found.length, 1, `exactly one step matching ${pattern}`);
  return found[0];
};
const stepTimeout = (step) => Number(/^ {8}timeout-minutes:\s*(\d+)/m.exec(step)?.[1]);

const deploy = read(".github/workflows/deploy.yml");

for (const job of ["staging", "production"]) {
  test(`deploy.yml ${job}: deploys exactly what the tag shipped (checkout of the tag, tag validated first)`, () => {
    const steps = jobSteps(deploy, job);
    const checkoutAt = steps.findIndex((s) => s.includes("actions/checkout@"));
    assert.ok(checkoutAt >= 0, "has a checkout");
    assert.match(
      steps[checkoutAt],
      /ref:\s*"?refs\/tags\/\$\{\{ inputs\.tag \}\}/,
      "checks out the tag, not the dispatch ref",
    );
    const validateAt = steps.findIndex((s) => /Validate the tag/i.test(s));
    assert.ok(validateAt >= 0 && validateAt < checkoutAt, "tag input validated before it reaches checkout");
    assert.match(steps[validateAt], /\^v\[0-9\]\+/, "tag must look like vX.Y.Z");
    assert.ok(
      !steps[validateAt].includes("${{"),
      "the tag reaches the shell as $TAG, never interpolated into the script",
    );
  });

  test(`deploy.yml ${job}: rolls back on failure and on cancellation (a timeout or a cancelled run)`, () => {
    const rollback = stepNamed(jobSteps(deploy, job), /rollback|Roll back/i);
    assert.match(rollback, /^ {8}if:\s*failure\(\) \|\| cancelled\(\)\s*$/m);
  });

  test(`deploy.yml ${job}: the timeouts cover the scripted worst case, for the deploy and for its rollback`, async () => {
    const { worstCaseSeconds } = await import("../scripts/deploy-images.mjs");
    const worstMinutes = worstCaseSeconds() / 60;
    assert.ok(worstMinutes >= 60, `worst case is ${worstMinutes} min (sanity)`);
    const steps = jobSteps(deploy, job);
    const deployStep = stepTimeout(stepNamed(steps, /Deploy by digest/));
    const rollbackStep = stepTimeout(stepNamed(steps, /rollback|Roll back/i));
    assert.ok(deployStep > worstMinutes, `deploy step ${deployStep} min must exceed ${worstMinutes}`);
    assert.ok(rollbackStep > worstMinutes, `rollback step ${rollbackStep} min must exceed ${worstMinutes}`);
    // The job must outlive deploy + rollback plus the verify, smoke and ZAP steps around them.
    assert.ok(
      jobTimeout(deploy, job) >= deployStep + rollbackStep + 30,
      "job timeout leaves room for both and the rest",
    );
  });
}
