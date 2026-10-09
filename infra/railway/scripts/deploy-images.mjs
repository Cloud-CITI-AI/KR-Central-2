#!/usr/bin/env node
/**
 * Promote the attested release images to a Railway environment (ADR-0008). For each service, in order: apply the
 * settings from infra/railway/services/<service>.json plus the image digest from image-<image>.txt, FAIL if Railway
 * reports different values, trigger a deployment and wait until it is healthy; stop at the first failure.
 *
 *   node deploy-images.mjs --environment staging --services "clamav migrate api worker web backup"
 *   node deploy-images.mjs --environment staging --services "api web" --dry-run     (offline: prints the plan, calls nothing)
 *
 * Environment: RAILWAY_TOKEN (a project token scoped to one environment; never printed), RAILWAY_ENVIRONMENT (optional,
 * must equal --environment). Exit codes: 0 done, 1 deployment failed (drift, unhealthy, timeout, API error), 2 bad usage.
 * Node 24, no dependencies. API calls are in lib/railway-client.mjs and documented in docs/deploy/railway.md.
 */
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createRailwayClient } from "./lib/railway-client.mjs";
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
} from "./lib/settings.mjs";

export class DeployError extends Error {
  constructor(message) {
    super(message);
    this.name = "DeployError";
  }
}

const USAGE =
  'Usage: deploy-images.mjs --environment <name> [--services "clamav migrate ..."] [--dry-run] [--images-dir <dir>] [--timeout-minutes <n>] [--poll-seconds <n>]';

export function parseOptions(argv, env = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        environment: { type: "string" },
        services: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        "images-dir": { type: "string", default: "." },
        "timeout-minutes": { type: "string" },
        "poll-seconds": { type: "string", default: "10" },
      },
    }));
  } catch (error) {
    throw new ConfigurationError(`${error.message}\n${USAGE}`);
  }
  const environment = values.environment ?? env.RAILWAY_ENVIRONMENT;
  if (!environment) throw new ConfigurationError(`--environment is required\n${USAGE}`);
  if (env.RAILWAY_ENVIRONMENT && env.RAILWAY_ENVIRONMENT !== environment) {
    throw new ConfigurationError(
      `--environment ${environment} differs from RAILWAY_ENVIRONMENT ${env.RAILWAY_ENVIRONMENT}`,
    );
  }
  const number = (name, raw) => {
    const n = Number(raw);
    if (!(n > 0)) throw new ConfigurationError(`--${name} must be a positive number`);
    return n;
  };
  return {
    environment,
    services: values.services === undefined ? undefined : parseServices(values.services),
    dryRun: values["dry-run"],
    imagesDir: values["images-dir"],
    timeoutSeconds:
      values["timeout-minutes"] === undefined ? undefined : number("timeout-minutes", values["timeout-minutes"]) * 60,
    pollSeconds: number("poll-seconds", values["poll-seconds"]),
  };
}

/** The services to act on, each with the state it should end in, in deployment order. */
function buildTargets(options) {
  return (options.services ?? SERVICE_ORDER).map((name) => {
    const settings = loadSettings(name);
    return { name, settings, state: desiredState(settings, readImageRef(options.imagesDir, settings.image)) };
  });
}

const describe = (state) => JSON.stringify({ ...state, image: state.image?.replace(/^.*\//, "") });

export async function run(options, { client, sleep, now, log, token }) {
  const targets = buildTargets(options);
  if (options.dryRun) {
    log(`Dry run (deploy to ${options.environment}); nothing is sent to Railway.`);
    for (const t of targets) log(`[${t.name}] would apply ${describe(t.state)} then deploy and wait for healthy`);
    return;
  }
  if (!token) throw new ConfigurationError("RAILWAY_TOKEN is not set");

  const scope = await client.scope();
  const { environments, services } = await client.project(scope.projectId);
  const environment = environments.find((e) => e.id === scope.environmentId);
  if (environment?.name !== options.environment) {
    throw new DeployError(
      `The Railway token is scoped to environment "${environment?.name}", not "${options.environment}"`,
    );
  }
  const ids = new Map(services.map((s) => [s.name, s.id]));
  const idOf = (name) => {
    if (!ids.has(name)) throw new ConfigurationError(`The Railway project has no service named "${name}"`);
    return ids.get(name);
  };

  const pending = targets.map((t) => t.name);
  for (const target of targets) {
    const { name, state } = target;
    const serviceId = idOf(name);
    try {
      await client.updateServiceInstance(serviceId, scope.environmentId, toUpdateInput(state));
      const drift = diffState(state, stateFromInstance(await client.serviceInstance(scope.environmentId, serviceId)));
      if (drift.length > 0) {
        throw new DeployError(
          `Railway reports different settings: ${drift.map((d) => `${d.field} expected ${JSON.stringify(d.expected)} got ${JSON.stringify(d.actual)}`).join("; ")}`,
        );
      }
      log(`[${name}] settings applied and verified`);
      const deploymentId = await client.deployServiceInstance(serviceId, scope.environmentId);
      log(`[${name}] deployment ${deploymentId} started`);
      await waitHealthy({ client, deploymentId, target, options, sleep, now });
      log(`[${name}] healthy`);
      pending.shift();
    } catch (error) {
      pending.shift();
      throw new DeployError(
        `[${name}] ${error.message}${pending.length > 0 ? `. Stopped; not deployed: ${pending.join(", ")}` : ""}`,
      );
    }
  }
  log(`Done: ${targets.length} service(s) deployed to ${options.environment}.`);
}

async function waitHealthy({ client, deploymentId, target, options, sleep, now }) {
  const timeoutSeconds = options.timeoutSeconds ?? Math.max(600, (target.state.healthcheckTimeout ?? 0) + 300);
  const deadline = now() + timeoutSeconds * 1000;
  for (;;) {
    const status = (await client.deployment(deploymentId))?.status ?? "UNKNOWN";
    const outcome = deploymentOutcome(status, target.settings);
    if (outcome === "healthy") return;
    if (outcome === "failed") throw new DeployError(`deployment ${deploymentId} is ${status}`);
    if (now() >= deadline)
      throw new DeployError(`deployment ${deploymentId} still ${status} after ${timeoutSeconds}s (timeout)`);
    await sleep(options.pollSeconds * 1000);
  }
}

export async function main(argv, env, deps = {}) {
  const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
  try {
    const options = parseOptions(argv, env);
    const token = env.RAILWAY_TOKEN;
    const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const client =
      options.dryRun || !token
        ? undefined
        : createRailwayClient({ token, fetch: deps.fetch, sleep: deps.clientSleep ?? sleep });
    await run(options, { client, sleep, now: deps.now ?? Date.now, log: out, token });
    return 0;
  } catch (error) {
    err(
      error instanceof ConfigurationError ? `Configuration error: ${error.message}` : `Deploy failed: ${error.message}`,
    );
    return error instanceof ConfigurationError ? 2 : 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
