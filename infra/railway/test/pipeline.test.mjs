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
  const found = steps.filter((s) => pattern.test(s));
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
    const rollback = stepNamed(jobSteps(deploy, job), /--rollback previous-/);
    assert.match(rollback, /^ {8}if:\s*failure\(\) \|\| cancelled\(\)\s*$/m);
  });

  test(`deploy.yml ${job}: the timeouts cover the scripted worst case, for the deploy and for its rollback`, async () => {
    const { worstCaseSeconds } = await import("../scripts/deploy-images.mjs");
    const worstMinutes = worstCaseSeconds() / 60;
    assert.ok(worstMinutes >= 60, `worst case is ${worstMinutes} min (sanity)`);
    const steps = jobSteps(deploy, job);
    const deployStep = stepTimeout(stepNamed(steps, /name: Deploy by digest/));
    const rollbackStep = stepTimeout(stepNamed(steps, /--rollback previous-/));
    assert.ok(deployStep > worstMinutes, `deploy step ${deployStep} min must exceed ${worstMinutes}`);
    assert.ok(rollbackStep > worstMinutes, `rollback step ${rollbackStep} min must exceed ${worstMinutes}`);
    // The job must outlive deploy + rollback plus the verify, smoke and ZAP steps around them.
    assert.ok(
      jobTimeout(deploy, job) >= deployStep + rollbackStep + 30,
      "job timeout leaves room for both and the rest",
    );
  });
}

// ---- release.yml (BUG 1) --------------------------------------------------------------------------------------------

test("release.yml: release-please runs with a GitHub App token so the release PR gets its required checks", () => {
  const release = read(".github/workflows/release.yml");
  const steps = jobSteps(release, "release-please");
  const tokenStep = stepNamed(steps, /create-github-app-token/);
  assert.match(tokenStep, /uses: actions\/create-github-app-token@[0-9a-f]{40} # v\d+\.\d+\.\d+/, "pinned by SHA");
  assert.match(tokenStep, /id: app-token/);
  assert.match(tokenStep, /private-key: \$\{\{ secrets\.RELEASE_APP_PRIVATE_KEY \}\}/);
  const rp = stepNamed(steps, /release-please-action/);
  assert.match(
    rp,
    /token: \$\{\{ steps\.app-token\.outputs\.token \}\}/,
    "release-please uses the App token, not GITHUB_TOKEN",
  );
  assert.ok(steps.indexOf(tokenStep) < steps.indexOf(rp), "the token is minted first");
  const header = release.slice(release.indexOf("  release-please:"), release.indexOf("    steps:"));
  assert.match(header, /environment: release/, "App credentials live in the release environment");
  assert.match(header, /permissions: \{\}/, "GITHUB_TOKEN is not used by this job");
});

test("playbook-guard.yml: the release-please PR is not treated as agent work and may only touch version files", () => {
  const guard = read(".github/workflows/playbook-guard.yml");
  assert.match(guard, /release-please--branches--\*/);
  assert.match(guard, /Release PR changes only the version files/);
  assert.match(guard, /CHANGELOG\\\.md\|package\\\.json\|\\\.release-please-manifest\\\.json/);
  assert.match(
    guard,
    /name: PR description has required sections filled\n\s+if: steps\.agent\.outputs\.release != 'true'/,
  );
});

test("railway.md documents the release App, its secrets, the release environment and the repository setting", () => {
  const guide = read("docs/deploy/railway.md");
  for (const term of [
    "RELEASE_APP_CLIENT_ID",
    "RELEASE_APP_PRIVATE_KEY",
    "`release` environment",
    "Allow GitHub Actions to create and approve pull requests",
    "Contents",
    "Pull requests",
  ])
    assert.ok(guide.includes(term), term);
});

// ---- docker-compose.yml, clamav (BUG 5) -----------------------------------------------------------------------------

test("docker-compose.yml: clamd gets KR_STACK_HOST as its bind address and the worker waits for it to be healthy", () => {
  const compose = read("docker-compose.yml");
  const clamav = /^ {2}clamav:\n((?: {4}.*\n|\n)+)/m.exec(compose)?.[1] ?? "";
  assert.match(clamav, /CLAMD_TCP_ADDR: \$\{KR_STACK_HOST:-::\}/, "same switch as api, worker and web");
  const worker = /^ {2}worker:\n((?: {4}.*\n|\n)+)/m.exec(compose)?.[1] ?? "";
  assert.match(worker, /clamav: \{ condition: service_healthy \}/);
  const dockerfile = read("infra/clamav/Dockerfile");
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/kr-entrypoint\.sh"\]/);
  assert.match(read("infra/clamav/clamd.conf"), /^TCPAddr ::$/m, "Railway default stays `::`");
});

// ---- README "Local development" (BUG 6) -----------------------------------------------------------------------------

test("README local development: bootstraps the roles and every dev/db script loads the root .env", () => {
  const readme = read("README.md");
  const steps = /## Local development\n[\s\S]*?```sh\n([\s\S]*?)```/.exec(readme)?.[1] ?? "";
  const order = ["pnpm db:up", "pnpm build", "db:bootstrap", "db:migrate", "pnpm dev"].map((s) => steps.indexOf(s));
  assert.ok(order.every((i) => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), steps);
  const envFlag = "--env-file-if-exists=../../.env";
  const script = (pkg, name) => JSON.parse(read(`${pkg}/package.json`)).scripts[name];
  assert.match(script("packages/db", "db:bootstrap"), new RegExp(`${envFlag} dist/bootstrap-cli\\.js`));
  assert.match(script("packages/db", "db:migrate"), new RegExp(`${envFlag} dist/migrate-cli\\.js`));
  for (const pkg of ["services/api", "services/worker"]) assert.ok(script(pkg, "dev").includes(envFlag), pkg);
  // api and worker read the same root .env, whose PORT is the api's: the worker's health endpoint needs its own.
  assert.match(script("services/worker", "dev"), /^PORT=8081 tsx watch /);
  // Next re-runs node with the flag copied into NODE_OPTIONS, where --env-file is not allowed: the web script loads it itself.
  assert.equal(script("apps/web", "dev"), "node ../../scripts/dev/web.mjs");
  assert.match(
    read("scripts/dev/web.mjs"),
    /process\.loadEnvFile\(new URL\("\.\.\/\.\.\/\.env", import\.meta\.url\)\)/,
  );
});

// ---- mock IdP launcher and compose service (BUG 7) ------------------------------------------------------------------

test("the local stack can sign in: the mock IdP has a launcher and a compose service on the authority URL the API uses", () => {
  const pkg = JSON.parse(read("packages/mock-idp/package.json"));
  assert.equal(pkg.bin["kr-mock-idp"], "./dist/cli.js");
  assert.match(pkg.scripts.start, /--env-file-if-exists=\.\.\/\.\.\/\.env dist\/cli\.js/);
  const compose = read("docker-compose.yml");
  const service = (name) => new RegExp(`^ {2}${name}:\\n((?: {4}.*\\n|\\n)+)`, "m").exec(compose)?.[1] ?? "";
  const idp = service("mock-idp");
  assert.match(idp, /dockerfile: packages\/mock-idp\/Dockerfile/);
  assert.match(idp, /aliases: \[mock-idp\.localhost\]/);
  assert.match(idp, /MOCK_IDP_PUBLIC_URL: http:\/\/mock-idp\.localhost:4010/);
  assert.match(idp, /ports: \["4010:4010"\]/);
  const api = service("api");
  assert.match(api, /ENTRA_AUTHORITY_HOST: http:\/\/mock-idp\.localhost:4010/);
  assert.match(api, /mock-idp: \{ condition: service_healthy \}/);
  assert.ok(existsSync(new URL("packages/mock-idp/Dockerfile", repo)));
});

// ---- image names and OCI labels (BUG 8) -----------------------------------------------------------------------------

test("release.yml: the image name is lower-cased in a step (registries refuse upper case) and the source label is a build arg", () => {
  const release = read(".github/workflows/release.yml");
  const header = release.slice(
    release.indexOf("  build-and-attest:"),
    release.indexOf("    steps:", release.indexOf("  build-and-attest:")),
  );
  assert.doesNotMatch(header, /^\s+IMAGE:/m, "IMAGE is not a static job env (it would keep the repository's case)");
  const steps = jobSteps(release, "build-and-attest");
  const name = stepNamed(steps, /name: Image name/);
  assert.match(name, /\$\{GITHUB_REPOSITORY,,\}/);
  assert.match(name, /ghcr\.io\/\$\{GITHUB_REPOSITORY,,\}\/\$\{SERVICE\}/);
  assert.match(name, /"\$GITHUB_ENV"/);
  const build = stepNamed(steps, /docker\/build-push-action/);
  assert.ok(steps.indexOf(name) < steps.indexOf(build), "the name is resolved before the build uses it");
  assert.match(build, /IMAGE_SOURCE=\$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}/);
  assert.match(build, /RELEASE_VERSION=\$\{\{ env\.TAG \}\}/);
});

for (const file of [
  "services/api/Dockerfile",
  "services/worker/Dockerfile",
  "services/ops/Dockerfile",
  "apps/web/Dockerfile",
  "infra/clamav/Dockerfile",
]) {
  test(`${file}: org.opencontainers.image.source comes from the IMAGE_SOURCE build arg, not a hard-coded repository`, () => {
    const dockerfile = read(file);
    assert.match(dockerfile, /^ARG IMAGE_SOURCE=?$/m);
    assert.match(dockerfile, /org\.opencontainers\.image\.source="\$\{IMAGE_SOURCE\}"/);
    assert.doesNotMatch(dockerfile, /github\.com\/cloudcitiwa\/kr-central-2/);
  });
}

// ---- web start script and worker Dockerfile comment (BUG 9) ---------------------------------------------------------

test("@kr/web start runs the standalone server (as the image and web.json do), not `next start`", () => {
  const start = JSON.parse(read("apps/web/package.json")).scripts.start;
  assert.doesNotMatch(start, /next start/);
  assert.equal(start, "node ../../scripts/dev/web-start.mjs");
  const script = read("scripts/dev/web-start.mjs");
  assert.match(script, /\.next\/standalone\/apps\/web\//);
  assert.match(script, /\.next\/static\//);
  assert.match(script, /"public\/"/);
  assert.match(read("infra/railway/services/web.json"), /"startCommand": "node apps\/web\/server\.js"/);
});

test("worker Dockerfile does not claim that the worker has no SIGTERM handler (src/main.ts installs one)", () => {
  assert.match(read("services/worker/src/main.ts"), /process\.on\("SIGTERM"/);
  assert.doesNotMatch(read("services/worker/Dockerfile"), /installs no SIGTERM handler|until WP-12 lands/);
});

// ---- docs: attestation plan requirement, front-channel logout (BUG 10, BUG 11) --------------------------------------

test("railway.md and ADR-0008 state that attestations for a private repository need GitHub Enterprise Cloud, with a fallback", () => {
  for (const file of ["docs/deploy/railway.md", "docs/adr/0008-railway-hosting-and-delivery.md"]) {
    const text = read(file);
    assert.match(text, /Enterprise Cloud/, file);
    assert.match(text, /cosign/, `${file} names the fallback`);
  }
  assert.match(read("docs/deploy/railway.md"), /Prerequisite: the GitHub plan must support artifact attestations/);
});

test("Entra checklist E3 and ADR-0002 register no front-channel logout URL (the page is static and not frameable)", () => {
  const guide = read("docs/deploy/railway.md");
  const e3 = /\| E3 .*\|/.exec(guide)?.[0] ?? "";
  assert.match(e3, /Leave the front-channel logout URL empty/);
  assert.match(e3, /post_logout_redirect_uri/);
  assert.doesNotMatch(e3, /front-channel logout URL\*\* `https/);
  const adr = read("docs/adr/0002-identity-entra-oidc-server-sessions.md");
  assert.doesNotMatch(adr, /front-channel logout `\{PUBLIC_BASE_URL\}/);
  assert.match(adr, /post-logout redirect URI `\{PUBLIC_BASE_URL\}\/signed-out`/);
  assert.match(adr, /No front-channel logout/);
  assert.doesNotMatch(read("docs/runbooks/auth-failure-spike.md"), /front-channel/);
});
