/**
 * The docker-compose `stack` profile starts in a safe order from a cold start: the migrate service takes its
 * pre-migration backup to the S3 mock, so it must wait until the mock answers, not only until its container exists
 * (adobe/s3mock needs a few seconds to listen; migrate otherwise exits with ECONNREFUSED and api, worker and web never
 * start). It also pins the database role credentials: `bootstrap` must hold every variable the bootstrap CLI requires
 * (packages/db/src/config.ts), and api, worker, web and mock-idp must not receive the DDL, superuser or backup
 * credentials or the backup bucket keys (ADR-0007, threat model M-23), not even when a developer's shell or `.env`
 * (README: a copy of .env.example) defines them. Reads the resolved configuration from `docker compose config`, so it
 * needs the Docker CLI but no daemon work.
 *
 *   node --test infra/test/compose-stack.test.mjs
 *
 * Only Node built-ins (infra/ is not a pnpm workspace package).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const composeFile = join(root, "docker-compose.yml");

/** The resolved stack configuration. `envFile` is passed as `--env-file`; `processEnv` is added to the shell environment. */
function resolveConfig({ envFile, processEnv } = {}) {
  const args = ["compose", "-f", composeFile];
  if (envFile) args.push("--env-file", envFile);
  args.push("--profile", "stack", "config", "--format", "json");
  // Without an env file Compose reads `.env` from the project directory; point it at a file that cannot exist so a
  // developer's own `.env` never changes the baseline.
  const cwd = mkdtempSync(join(tmpdir(), "kr-compose-cwd-"));
  try {
    return JSON.parse(execFileSync("docker", args, { encoding: "utf8", cwd, env: { ...process.env, ...processEnv } }));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const config = resolveConfig();

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
});

/**
 * Every variable only the ops jobs may hold, each with a distinctive value so a leak is visible under any name.
 * (bootstrap and migrate set their own values literally; the others must not pick these up.)
 */
const SENTINEL = "leaked-from-shell-or-dotenv";
const PRIVILEGED = {
  MIGRATION_DATABASE_URL: `postgres://tracker_migrator:${SENTINEL}@localhost:5432/tracker`,
  SUPERUSER_DATABASE_URL: `postgres://postgres:${SENTINEL}@localhost:5432/tracker`,
  BACKUP_DATABASE_URL: `postgres://tracker_backup:${SENTINEL}@localhost:5432/tracker`,
  TRACKER_MIGRATOR_PASSWORD: SENTINEL,
  TRACKER_APP_PASSWORD: SENTINEL,
  TRACKER_BACKUP_PASSWORD: SENTINEL,
  BACKUP_S3_ENDPOINT: `http://${SENTINEL}:9090`,
  BACKUP_S3_REGION: SENTINEL,
  BACKUP_S3_BUCKET: SENTINEL,
  BACKUP_S3_ACCESS_KEY_ID: SENTINEL,
  BACKUP_S3_SECRET_ACCESS_KEY: SENTINEL,
  BACKUP_RETENTION_DAYS: "99",
  PG_DUMP_PATH: SENTINEL,
};
const OPS_ONLY_KEYS = [...Object.keys(PRIVILEGED)];

describe("docker-compose stack profile privileged credentials", () => {
  const dir = mkdtempSync(join(tmpdir(), "kr-compose-env-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = join(dir, "privileged.env");
  writeFileSync(
    envFile,
    Object.entries(PRIVILEGED)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
  );
  const withEnvFile = resolveConfig({ envFile });
  const withShellEnv = resolveConfig({ processEnv: PRIVILEGED });

  const received = (cfg, service) =>
    Object.entries(cfg.services[service].environment ?? {}).filter(([, v]) => v !== null && v !== undefined);

  it("guards the list: .env.example defines every privileged database credential", () => {
    const keys = privilegedSecretKeys();
    for (const key of ["MIGRATION_DATABASE_URL", "SUPERUSER_DATABASE_URL", "BACKUP_DATABASE_URL"]) {
      assert.ok(keys.includes(key), `${key} is not in .env.example (keys: ${keys})`);
    }
    for (const key of keys) assert.ok(OPS_ONLY_KEYS.includes(key), `${key} is missing from the test's privileged list`);
  });

  it("does not read .env.example or any env file wholesale", () => {
    const source = readFileSync(composeFile, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.ok(
      !/^\s*env_file:/m.test(source),
      "a service uses env_file (it would inject variables that are not listed)",
    );
  });

  for (const service of ["api", "worker", "web", "mock-idp"]) {
    for (const [label, cfg] of [
      ["no env file", config],
      ["an env file that defines them", withEnvFile],
      ["a shell that exports them", withShellEnv],
    ]) {
      it(`gives ${service} no database admin, backup or backup bucket variable (${label})`, () => {
        const pairs = received(cfg, service);
        const leakedKeys = pairs.filter(([k]) => OPS_ONLY_KEYS.includes(k)).map(([k]) => k);
        assert.deepEqual(leakedKeys, [], `${service} receives ${leakedKeys.join(", ")}`);
        const leakedValues = pairs.filter(([, v]) => String(v).includes(SENTINEL)).map(([k]) => k);
        assert.deepEqual(leakedValues, [], `${service} receives a value from the env file or shell in ${leakedValues}`);
      });
    }
  }

  it("does not let a developer's .env or shell change any service's environment", () => {
    for (const service of Object.keys(config.services)) {
      assert.deepEqual(withEnvFile.services[service].environment, config.services[service].environment, service);
      assert.deepEqual(withShellEnv.services[service].environment, config.services[service].environment, service);
    }
  });

  it("still gives bootstrap and migrate their own credentials", () => {
    for (const cfg of [config, withEnvFile, withShellEnv]) {
      const bootstrap = cfg.services.bootstrap.environment;
      for (const key of [
        "SUPERUSER_DATABASE_URL",
        "TRACKER_MIGRATOR_PASSWORD",
        "TRACKER_APP_PASSWORD",
        "TRACKER_BACKUP_PASSWORD",
      ]) {
        assert.ok(bootstrap[key] && !bootstrap[key].includes(SENTINEL), `bootstrap ${key}: ${bootstrap[key]}`);
      }
      const migrate = cfg.services.migrate.environment;
      assert.match(
        migrate.MIGRATION_DATABASE_URL ?? "",
        /^postgres:\/\/tracker_migrator:local-migrator-password@postgres:/,
      );
      for (const key of [
        "BACKUP_S3_ENDPOINT",
        "BACKUP_S3_BUCKET",
        "BACKUP_S3_ACCESS_KEY_ID",
        "BACKUP_S3_SECRET_ACCESS_KEY",
      ]) {
        assert.ok(migrate[key] && !migrate[key].includes(SENTINEL), `migrate ${key}: ${migrate[key]}`);
      }
    }
  });

  it("keeps the application services' own settings (database, files bucket, sign-in)", () => {
    const env = (service) => config.services[service].environment;
    for (const service of ["api", "worker"]) {
      assert.match(env(service).DATABASE_URL, /^postgres:\/\/tracker_app:local-app-password@postgres:/, service);
      assert.equal(env(service).S3_ENDPOINT, "http://s3:9090", service);
    }
    assert.equal(env("worker").CLAMAV_HOST, "clamav");
    // The API and the mock IdP agree on the tenant, client and secret; the worker never signs anyone in.
    for (const key of ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET"]) {
      assert.ok(env("api")[key], `api ${key}`);
      assert.equal(env("mock-idp")[key], env("api")[key], key);
      assert.equal(env("worker")[key] ?? null, null, `worker must not receive ${key}`);
    }
  });

  it("gives api and worker the same values as .env.example for the settings that are not host names", () => {
    const example = Object.fromEntries(
      [...readFileSync(join(root, ".env.example"), "utf8").matchAll(/^([A-Z][A-Z0-9_]*)=([^\s#]*)/gm)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    const hostSpecific = new Set([
      "NODE_ENV",
      "PORT",
      "HOST",
      "DATABASE_URL",
      "S3_ENDPOINT",
      "CLAMAV_HOST",
      "ENTRA_AUTHORITY_HOST",
    ]);
    for (const service of ["api", "worker", "mock-idp"]) {
      for (const [key, value] of received(config, service)) {
        if (hostSpecific.has(key) || !(key in example) || key.startsWith("MOCK_IDP_")) continue;
        assert.equal(value, example[key], `${service} ${key} differs from .env.example`);
      }
    }
  });
});
