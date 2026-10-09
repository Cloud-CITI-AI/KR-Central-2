import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ConfigurationError,
  SERVICE_ORDER,
  deploymentOutcome,
  desiredState,
  diffState,
  loadSettings,
  parseServices,
  readImageRef,
  stateFromInstance,
  toUpdateInput,
} from "../scripts/lib/settings.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const ref = (image) => `ghcr.io/example/repo/${image}@${DIGEST}`;

test("parseServices accepts the deployment order, spaces or commas, and subsets of it", () => {
  assert.deepEqual(parseServices(SERVICE_ORDER.join(" ")), SERVICE_ORDER);
  assert.deepEqual(parseServices("migrate,api"), ["migrate", "api"]);
});

test("parseServices refuses empty, unknown, duplicate and out-of-order lists", () => {
  for (const bad of ["", "api database", "api api", "api migrate", "web clamav"]) {
    assert.throws(() => parseServices(bad), ConfigurationError, bad);
  }
});

test("loadSettings returns the committed settings and rejects unknown services", () => {
  assert.equal(loadSettings("api").healthcheck.path, "/readyz");
  assert.throws(() => loadSettings("database"), /Cannot read settings for database/);
});

test("readImageRef returns a digest reference and refuses tags, missing files and junk", () => {
  const dir = mkdtempSync(join(tmpdir(), "kr-images-"));
  writeFileSync(join(dir, "image-api.txt"), `${ref("api")}\n`);
  writeFileSync(join(dir, "image-web.txt"), "ghcr.io/example/repo/web:v1.2.3\n");
  writeFileSync(join(dir, "image-ops.txt"), `evil.example/ops@${DIGEST}`);
  assert.equal(readImageRef(dir, "api"), ref("api"));
  assert.throws(() => readImageRef(dir, "web"), /must hold ghcr\.io/);
  assert.throws(() => readImageRef(dir, "ops"), /must hold ghcr\.io/);
  assert.throws(() => readImageRef(dir, "worker"), /Cannot read image-worker\.txt/);
});

test("desiredState maps the settings file and the image to Railway's field names", () => {
  assert.deepEqual(desiredState(loadSettings("api"), ref("api")), {
    image: ref("api"),
    startCommand: "node dist/main.js",
    healthcheckPath: "/readyz",
    healthcheckTimeout: 60,
    restartPolicyType: "ON_FAILURE",
    restartPolicyMaxRetries: 10,
    cronSchedule: null,
    numReplicas: 1,
    sleepApplication: false,
  });
  const backup = desiredState(loadSettings("backup"), ref("ops"));
  assert.equal(backup.cronSchedule, "15 18 * * *");
  assert.equal(backup.healthcheckPath, null);
  assert.equal(backup.restartPolicyMaxRetries, null, "retries are only declared for ON_FAILURE");
});

test("toUpdateInput nests the image under source and keeps nulls so unset settings are cleared", () => {
  const input = toUpdateInput(desiredState(loadSettings("clamav"), ref("clamav")));
  assert.deepEqual(input.source, { image: ref("clamav") });
  assert.equal(input.startCommand, null);
  assert.equal(input.healthcheckPath, null);
});

test("stateFromInstance and diffState detect every drifting field and ignore matching ones", () => {
  const settings = loadSettings("web");
  const expected = desiredState(settings, ref("web"));
  const instance = {
    source: { image: ref("web") },
    startCommand: "node apps/web/server.js",
    healthcheckPath: "/api/healthz",
    healthcheckTimeout: 60,
    restartPolicyType: "ON_FAILURE",
    restartPolicyMaxRetries: 10,
    cronSchedule: null,
    numReplicas: 1,
    sleepApplication: false,
  };
  assert.deepEqual(diffState(expected, stateFromInstance(instance)), []);
  const drifted = {
    ...instance,
    healthcheckPath: "/",
    numReplicas: 2,
    sleepApplication: undefined,
    source: { image: ref("api") },
  };
  assert.deepEqual(
    diffState(expected, stateFromInstance(drifted)).map((d) => d.field),
    ["image", "healthcheckPath", "numReplicas"],
  );
  assert.deepEqual(stateFromInstance({}).image, null);
});

test("deploymentOutcome is healthy at SUCCESS, failed on terminal failures, pending otherwise", () => {
  const web = loadSettings("web");
  const backup = loadSettings("backup");
  assert.equal(deploymentOutcome("SUCCESS", web), "healthy");
  for (const status of ["FAILED", "CRASHED", "REMOVED", "SKIPPED", "NEEDS_APPROVAL"]) {
    assert.equal(deploymentOutcome(status, web), "failed", status);
  }
  for (const status of ["INITIALIZING", "QUEUED", "BUILDING", "DEPLOYING", "WAITING"]) {
    assert.equal(deploymentOutcome(status, web), "pending", status);
  }
  assert.equal(deploymentOutcome("SLEEPING", web), "pending");
  assert.equal(deploymentOutcome("SLEEPING", backup), "healthy");
});
