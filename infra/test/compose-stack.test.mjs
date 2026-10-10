/**
 * The docker-compose `stack` profile starts in a safe order from a cold start: the migrate service takes its
 * pre-migration backup to the S3 mock, so it must wait until the mock answers, not only until its container exists
 * (adobe/s3mock needs a few seconds to listen; migrate otherwise exits with ECONNREFUSED and api, worker and web never
 * start). Reads the resolved configuration from `docker compose config`, so it needs the Docker CLI but no daemon work.
 *
 *   node --test infra/test/compose-stack.test.mjs
 *
 * Only Node built-ins (infra/ is not a pnpm workspace package).
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = JSON.parse(
  execFileSync(
    "docker",
    ["compose", "-f", join(root, "docker-compose.yml"), "--profile", "stack", "config", "--format", "json"],
    {
      encoding: "utf8",
    },
  ),
);

describe("docker-compose stack profile start order", () => {
  it("gives the S3 mock a health check that calls its HTTP endpoint", () => {
    const test = config.services.s3.healthcheck?.test ?? [];
    assert.ok(test.join(" ").includes("9090"), `s3 health check: ${JSON.stringify(test)}`);
  });

  it("starts migrate (pre-migration backup to S3) only once the S3 mock is healthy", () => {
    assert.equal(config.services.migrate.depends_on.s3.condition, "service_healthy");
  });
});
