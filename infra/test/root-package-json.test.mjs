/**
 * release-please (node release type) rewrites the root package.json with JSON.parse + JSON.stringify(..., 2) and sets
 * "version". playbook-guard then allows a release PR to change only the "version" line, so the file must already be in
 * the exact form release-please writes: byte-identical round trip, and a "version" field that matches the manifest.
 *
 *   node --test infra/test/root-package-json.test.mjs
 *
 * Only Node built-ins (infra/ is not a pnpm workspace package).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const raw = read("package.json");
const pkg = JSON.parse(raw);

test("package.json round-trips byte-identically through JSON.parse and JSON.stringify(…, 2)", () => {
  assert.equal(JSON.stringify(pkg, null, 2) + "\n", raw);
});

test("package.json has a version equal to the release-please manifest (so a release PR changes one line)", () => {
  const manifest = JSON.parse(read(".release-please-manifest.json"));
  assert.equal(typeof pkg.version, "string");
  assert.equal(pkg.version, manifest["."]);
});

test("the release PR diff filter of playbook-guard sees only the version line after a bump", () => {
  const bumped = JSON.stringify({ ...pkg, version: "9.9.9" }, null, 2) + "\n";
  const changed = (a, b) => {
    const x = a.split("\n");
    const y = b.split("\n");
    return [...x.filter((l) => !y.includes(l)), ...y.filter((l) => !x.includes(l))];
  };
  const lines = changed(raw, bumped).filter((l) => !/^\s*"version":\s*"[^"]*",?\s*$/.test(l));
  assert.deepEqual(lines, []);
});
