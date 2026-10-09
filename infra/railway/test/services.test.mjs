import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { validate } from "../scripts/lib/json-schema.mjs";

const here = new URL("../", import.meta.url);
const repo = new URL("../../../", import.meta.url);
const read = (url) => readFileSync(url, "utf8");
const schema = JSON.parse(read(new URL("service.schema.json", here)));
const NAMES = ["clamav", "migrate", "api", "worker", "web", "backup"];
const settings = Object.fromEntries(
  NAMES.map((name) => [name, JSON.parse(read(new URL(`services/${name}.json`, here)))]),
);

test("every topology service has exactly one settings file and no other files exist", () => {
  const files = readdirSync(new URL("services/", here)).sort();
  assert.deepEqual(files, NAMES.map((name) => `${name}.json`).sort());
});

test("every settings file is valid against service.schema.json and named after its service", () => {
  for (const name of NAMES) {
    assert.deepEqual(validate(schema, settings[name]), [], name);
    assert.equal(settings[name].service, name);
  }
});

test("the validator rejects wrong types, unknown properties and out-of-range values", () => {
  const good = settings.api;
  const bad = [
    { ...good, replicas: 0 },
    { ...good, replicas: "1" },
    { ...good, extra: true },
    { ...good, service: "database" },
    { ...good, healthcheck: { path: "readyz", timeoutSeconds: 60 } },
    { ...good, healthcheck: { path: "/readyz" } },
    { ...good, restartPolicy: { type: "SOMETIMES", maxRetries: 1 } },
    { ...good, cronSchedule: "daily" },
    { ...good, startCommand: "" },
  ];
  for (const candidate of bad) assert.notDeepEqual(validate(schema, candidate), [], JSON.stringify(candidate));
  const { sleepApplication: _omitted, ...incomplete } = good;
  assert.match(validate(schema, incomplete).join(), /missing required property "sleepApplication"/);
});

test("the validator refuses a schema keyword it does not implement", () => {
  assert.throws(() => validate({ oneOf: [] }, 1), /unsupported keyword "oneOf"/);
});

test("health-check paths and timeouts follow ADR-0008", () => {
  const health = (name) => settings[name].healthcheck?.path ?? null;
  assert.deepEqual(NAMES.map(health), [null, "/healthz", "/readyz", "/healthz", "/api/healthz", null]);
  assert.ok(
    settings.migrate.healthcheck.timeoutSeconds >= 300,
    "migrations may run for minutes before /healthz is 200",
  );
});

test("only the backup service is a cron job, daily at 18:15 UTC (02:15 Perth)", () => {
  for (const name of NAMES) assert.equal(settings[name].cronSchedule, name === "backup" ? "15 18 * * *" : null, name);
});

test("migrate and backup run the ops image, every other service its own image", () => {
  assert.deepEqual(
    NAMES.map((name) => settings[name].image),
    ["clamav", "ops", "api", "worker", "web", "ops"],
  );
});

test("start commands match what the images and package scripts run", () => {
  const ops = JSON.parse(read(new URL("services/ops/package.json", repo)));
  assert.equal(`node ${ops.scripts["start:migrate"].replace(/^node /, "")}`, settings.migrate.startCommand);
  assert.equal(`node ${ops.scripts["start:backup"].replace(/^node /, "")}`, settings.backup.startCommand);
  const cmd = (dockerfile) =>
    /^CMD \[(.*)\]$/m
      .exec(read(new URL(dockerfile, repo)))?.[1]
      .replaceAll('"', "")
      .split(", ")
      .join(" ");
  assert.equal(cmd("services/api/Dockerfile"), settings.api.startCommand);
  assert.equal(cmd("services/worker/Dockerfile"), settings.worker.startCommand);
  assert.equal(cmd("apps/web/Dockerfile"), settings.web.startCommand);
  assert.equal(settings.clamav.startCommand, null, "clamav keeps the upstream /init entrypoint");
});

test("continuous services restart on failure; the migration and the cron job never restart", () => {
  for (const name of NAMES) {
    const policy = settings[name].restartPolicy;
    const oneShot = name === "migrate" || name === "backup";
    assert.equal(policy.type, oneShot ? "NEVER" : "ON_FAILURE", name);
  }
});

test("no service sleeps and every service runs one replica until load data says otherwise", () => {
  for (const name of NAMES) {
    assert.equal(settings[name].sleepApplication, false, name);
    assert.equal(settings[name].replicas, 1, name);
  }
});
