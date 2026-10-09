import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../scripts/deploy-images.mjs";
import { SERVICE_ORDER } from "../scripts/lib/settings.mjs";
import { fakeRailway, harness, imageRef, imagesDir } from "./fake-railway.mjs";

const ALL = SERVICE_ORDER.join(" ");
const run = (railway, args, env) => {
  const h = harness(railway, env);
  return main(args, h.env, h.deps).then((code) => ({ code, ...h }));
};
const deployArgs = (...more) => ["--environment", "staging", "--services", ALL, "--images-dir", imagesDir(), ...more];

test("deploys every service in order, applies settings and the image digest, waits for each to be healthy", async () => {
  const railway = fakeRailway();
  const { code, errors } = await run(railway, deployArgs());
  assert.deepEqual(errors, []);
  assert.equal(code, 0);
  assert.deepEqual(
    railway.calls(),
    SERVICE_ORDER.flatMap((name) => [`update ${name}`, `deploy ${name}`]),
  );
  // a service is polled to SUCCESS before the next one is touched
  const log = railway.log;
  for (const [i, name] of SERVICE_ORDER.slice(0, -1).entries()) {
    assert.ok(log.indexOf(`poll ${name} SUCCESS`) < log.indexOf(`update ${SERVICE_ORDER[i + 1]}`), name);
  }
  assert.equal(railway.instances.get("migrate").source.image, imageRef("ops"));
  assert.equal(railway.instances.get("backup").source.image, imageRef("ops"));
  assert.equal(railway.instances.get("backup").cronSchedule, "15 18 * * *");
  assert.equal(railway.instances.get("api").healthcheckPath, "/readyz");
});

test("stops at the first unhealthy service and starts nothing after it", async () => {
  const railway = fakeRailway({ statuses: { api: ["DEPLOYING", "FAILED"] } });
  const { code, errors } = await run(railway, deployArgs());
  assert.equal(code, 1);
  assert.deepEqual(railway.calls(), [
    "update clamav",
    "deploy clamav",
    "update migrate",
    "deploy migrate",
    "update api",
    "deploy api",
  ]);
  assert.match(errors.join("\n"), /\[api\] deployment .* is FAILED\. Stopped; not deployed: worker, web, backup/);
});

test("a service that never becomes healthy times out and stops the run", async () => {
  const railway = fakeRailway({ statuses: { migrate: ["DEPLOYING"] } });
  const { code, errors } = await run(railway, deployArgs("--timeout-minutes", "2", "--poll-seconds", "30"));
  assert.equal(code, 1);
  assert.match(errors.join("\n"), /\[migrate\] deployment .* still DEPLOYING after 120s \(timeout\)/);
  assert.equal(railway.calls().at(-1), "deploy migrate");
});

test("fails without deploying when Railway reports different settings after the update", async () => {
  const railway = fakeRailway({ ignore: { api: { healthcheckPath: "/" } } });
  const { code, errors } = await run(railway, deployArgs());
  assert.equal(code, 1);
  assert.match(
    errors.join("\n"),
    /\[api\] Railway reports different settings: healthcheckPath expected "\/readyz" got "\/"/,
  );
  assert.ok(!railway.calls().includes("deploy api"));
  assert.ok(!railway.calls().includes("update worker"));
});

test("--dry-run prints the plan and sends nothing, with or without a token", async () => {
  for (const env of [{}, { RAILWAY_TOKEN: "" }]) {
    const railway = fakeRailway();
    const h = harness(railway, env);
    const code = await main(deployArgs("--dry-run"), h.env, h.deps);
    assert.equal(code, 0);
    assert.equal(railway.log.length, 0);
    assert.equal(h.lines.filter((l) => l.includes("would apply")).length, 6);
    assert.match(h.lines.join("\n"), /\[web\] would apply .*"healthcheckPath":"\/api\/healthz"/);
  }
});

test("refuses a token scoped to another environment, a missing token and a project without the service", async () => {
  const wrongEnv = await run(fakeRailway({ environmentName: "production" }), deployArgs());
  assert.equal(wrongEnv.code, 1);
  assert.match(wrongEnv.errors.join(), /scoped to environment "production", not "staging"/);
  const noToken = await run(fakeRailway(), deployArgs(), { RAILWAY_TOKEN: "" });
  assert.equal(noToken.code, 2);
  assert.match(noToken.errors.join(), /RAILWAY_TOKEN is not set/);
});

test("usage errors exit 2 before any request: missing environment, mismatch, bad services, no digest file", async () => {
  const railway = fakeRailway();
  const cases = [
    [["--services", ALL], /--environment is required/],
    [["--environment", "staging"], /Cannot read image-clamav\.txt/],
    [["--environment", "staging", "--services", "web api"], /deployment order/],
  ];
  for (const [args, pattern] of cases) {
    const { code, errors } = await run(railway, args);
    assert.equal(code, 2, args.join(" "));
    assert.match(errors.join(), pattern);
  }
  const mismatch = await run(railway, deployArgs(), { RAILWAY_ENVIRONMENT: "production" });
  assert.equal(mismatch.code, 2);
  assert.match(mismatch.errors.join(), /differs from RAILWAY_ENVIRONMENT/);
  assert.equal(railway.log.length, 0);
});
