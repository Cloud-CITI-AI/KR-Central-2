import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const repo = new URL("../../../", import.meta.url);
const guide = readFileSync(new URL("docs/deploy/railway.md", repo), "utf8");
const envExample = readFileSync(new URL(".env.example", repo), "utf8");
const variables = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);

test("the deploy guide mentions every variable in .env.example", () => {
  assert.ok(variables.length > 50, "found the variables");
  const missing = variables.filter((name) => !new RegExp(`\\b${name}\\b`).test(guide));
  assert.deepEqual(missing, [], `undocumented: ${missing.join(", ")}`);
});

test("the guide documents every service of the topology and the pipeline switches", () => {
  for (const name of ["clamav", "migrate", "api", "worker", "web", "backup"])
    assert.match(guide, new RegExp(`\`${name}\``), name);
  for (const term of ["RAILWAY_TOKEN", "DEPLOYS_FROZEN", "bootstrap-cli", "TRUST_PROXY_HOPS", "GHCR"])
    assert.ok(guide.includes(term), term);
});
