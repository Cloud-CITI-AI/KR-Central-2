import { execFileSync, spawn } from "node:child_process";
import { REPO_ROOT } from "../e2e/harness/constants";
import { expect, test } from "../e2e/fixtures";
import { STAFF } from "../e2e/harness/users";
import { seedDashboard } from "./data";

// PRODUCT_SPEC section 14: API reads p95 < 300 ms, p99 < 800 ms. The thresholds live in services/api/load/smoke.js; this
// driver gives it a stack, a staff session created by the harness (the real OIDC flow) and 24 synthetic jobs.

const LOAD_DIR = `${REPO_ROOT}services/api/load`;
const K6_IMAGE =
  process.env.K6_IMAGE ??
  "mirror.gcr.io/grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34";

function hasLocalK6(): boolean {
  try {
    execFileSync("k6", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** k6 when it is installed, else the grafana/k6 image on the host network (the API listens on the host's loopback). */
function k6Command(container: string): { command: string; args: string[] } {
  if (hasLocalK6()) return { command: "k6", args: ["run", `${LOAD_DIR}/smoke.js`] };
  return {
    command: "docker",
    args: ["run", "--rm", "--name", container, "--network", "host", "-v", `${LOAD_DIR}:/load:ro`].concat([
      "-e",
      "BASE_URL",
      "-e",
      "SESSION_COOKIE",
      "-e",
      "VUS",
      "-e",
      "DURATION",
      K6_IMAGE,
      "run",
      "/load/smoke.js",
    ]),
  };
}

test("the API reads stay within p95 < 300 ms and p99 < 800 ms under the k6 smoke", async ({
  apiAs,
  stack,
}, testInfo) => {
  const staff = await apiAs(STAFF);
  await seedDashboard(staff, 24);
  const container = `kr-wp22-k6-${process.pid.toString()}`;
  const { command, args } = k6Command(container);
  const env = { ...process.env, BASE_URL: stack.apiUrl, SESSION_COOKIE: staff.sessionId };

  let output = "";
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, args, { env });
    const collect = (chunk: Buffer) => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", resolve);
  }).finally(() => {
    // `--rm` removes the container on exit; this covers a run that was killed first.
    try {
      execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
    } catch {
      // not running through docker, or already gone
    }
  });

  process.stdout.write(`${output}\n`);
  await testInfo.attach("k6-summary", { body: output, contentType: "text/plain" });
  expect(
    exitCode,
    `k6 exited with ${String(exitCode)}: a threshold failed or the run broke (see the k6 output above)`,
  ).toBe(0);
});
