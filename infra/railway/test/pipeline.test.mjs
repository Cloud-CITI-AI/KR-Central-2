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
