/**
 * The docker-compose `stack` profile starts in a safe order from a cold start: the migrate service takes its
 * pre-migration backup to the S3 mock, so it must wait until the mock answers, not only until its container exists
 * (adobe/s3mock needs a few seconds to listen; migrate otherwise exits with ECONNREFUSED and api, worker and web never
 * start). It also pins the database role credentials: `bootstrap` must hold every variable the bootstrap CLI requires
 * (packages/db/src/config.ts), and the application services must not receive the DDL, superuser or backup credentials
 * that `.env.example` would otherwise inject (ADR-0007, threat model M-23). Reads the resolved configuration from
 * `docker compose config`, so it needs the Docker CLI but no daemon work.
 *
 *   node --test infra/test/compose-stack.test.mjs
 *
 * Only Node built-ins (infra/ is not a pnpm workspace package).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

/** Keys of the `BootstrapEnv` zod object in packages/db/src/config.ts (the variables bootstrap-cli requires). */
function bootstrapEnvKeys() {
  const source = readFileSync(join(root, "packages", "db", "src", "config.ts"), "utf8");
  const body = /const BootstrapEnv = z\.object\(\{([\s\S]*?)\}\);/.exec(source)?.[1];
  assert.ok(body, "BootstrapEnv schema not found in packages/db/src/config.ts");
  return [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
}

/** Database administration and backup credentials in .env.example: only the migrate/backup jobs (or bootstrap) hold them. */
function privilegedSecretKeys() {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  const keys = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
  return keys.filter(
    (k) => /^(MIGRATION|SUPERUSER|BACKUP)_DATABASE_URL$/.test(k) || /^TRACKER_[A-Z]+_PASSWORD$/.test(k),
  );
}

describe("docker-compose stack profile database roles", () => {
  it("reads the required bootstrap variables from the schema (guards the parser)", () => {
    assert.deepEqual(bootstrapEnvKeys().sort(), [
      "SUPERUSER_DATABASE_URL",
      "TRACKER_APP_PASSWORD",
      "TRACKER_BACKUP_PASSWORD",
      "TRACKER_MIGRATOR_PASSWORD",
    ]);
  });

  it("gives bootstrap every variable the bootstrap CLI requires", () => {
    const environment = config.services.bootstrap.environment ?? {};
    for (const key of bootstrapEnvKeys()) {
      assert.ok(
        typeof environment[key] === "string" && environment[key].length > 0,
        `bootstrap does not set ${key} (it would exit with "Invalid configuration: ${key}")`,
      );
    }
  });

  it("gives bootstrap the same role passwords as the connection URLs in .env.example", () => {
    const example = readFileSync(join(root, ".env.example"), "utf8");
    const environment = config.services.bootstrap.environment ?? {};
    for (const [role, key] of [
      ["tracker_migrator", "TRACKER_MIGRATOR_PASSWORD"],
      ["tracker_app", "TRACKER_APP_PASSWORD"],
      ["tracker_backup", "TRACKER_BACKUP_PASSWORD"],
    ]) {
      const url = new RegExp(`^[A-Z_]*DATABASE_URL=postgres://${role}:([^@]+)@`, "m").exec(example);
      assert.ok(url, `no connection URL for ${role} in .env.example`);
      assert.equal(environment[key], url[1], `${key} must equal the ${role} password in .env.example`);
    }
  });

  for (const service of ["api", "worker", "web"]) {
    it(`strips every database admin and backup credential from ${service}`, () => {
      const keys = privilegedSecretKeys();
      assert.ok(keys.includes("BACKUP_DATABASE_URL") && keys.includes("TRACKER_BACKUP_PASSWORD"), `keys: ${keys}`);
      const environment = config.services[service].environment ?? {};
      const leaked = keys.filter((k) => environment[k] !== null && environment[k] !== undefined);
      // `null` (or absent, for a service without env_file) means the variable is not in the container.
      assert.deepEqual(leaked, [], `${service} receives ${leaked.join(", ")}`);
      if (service !== "web") {
        const nulled = keys.filter((k) => environment[k] === null);
        assert.deepEqual(nulled.sort(), [...keys].sort(), `${service} must null every one of them explicitly`);
      }
    });
  }
});
