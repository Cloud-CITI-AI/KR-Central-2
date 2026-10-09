/** An in-memory Railway: a fetch() that answers the deploy script's GraphQL calls and records what it was asked. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QUERIES } from "../scripts/lib/railway-client.mjs";
import { SERVICE_ORDER } from "../scripts/lib/settings.mjs";

export const digest = (char) => `sha256:${char.repeat(64)}`;
export const IMAGES = { clamav: "c", ops: "d", api: "a", worker: "b", web: "e" };
export const imageRef = (image, char = IMAGES[image]) => `ghcr.io/example/repo/${image}@${digest(char)}`;

/** A directory with the release's image-<image>.txt files. */
export function imagesDir(chars = IMAGES) {
  const dir = mkdtempSync(join(tmpdir(), "kr-deploy-"));
  for (const [image, char] of Object.entries(chars))
    writeFileSync(join(dir, `image-${image}.txt`), `${imageRef(image, char)}\n`);
  return dir;
}

const edge = (name) => ({ node: { id: `svc-${name}`, name } });
/** Services that already run an earlier release; the others were never deployed. */
const PREVIOUS = ["api", "worker", "web"];
const OLD = (name) => ({
  source: { image: PREVIOUS.includes(name) ? imageRef(name, "0") : null },
  startCommand: null,
  healthcheckPath: null,
  healthcheckTimeout: null,
  restartPolicyType: "ON_FAILURE",
  restartPolicyMaxRetries: 10,
  cronSchedule: null,
  numReplicas: 1,
  sleepApplication: false,
  latestDeployment: { id: `old-${name}`, status: "SUCCESS" },
});

/** statuses: what a service's deployment reports in turn; ignore: fields an update silently drops (drift). */
export function fakeRailway({ statuses = {}, ignore = {}, environmentName = "staging", onUpdate } = {}) {
  const instances = new Map(SERVICE_ORDER.map((name) => [name, OLD(name)]));
  const deployments = new Map();
  const log = [];
  const handlers = [
    [QUERIES.projectToken, () => ({ projectToken: { projectId: "proj", environmentId: "env-1" } })],
    [
      QUERIES.project,
      () => ({
        project: {
          environments: { edges: [{ node: { id: "env-1", name: environmentName } }] },
          services: { edges: SERVICE_ORDER.map(edge) },
        },
      }),
    ],
    [QUERIES.serviceInstance, ({ serviceId }) => ({ serviceInstance: instances.get(serviceId.slice(4)) })],
    [
      QUERIES.update,
      ({ serviceId, input }) => {
        const name = serviceId.slice(4);
        log.push(`update ${name}`);
        onUpdate?.(name, input);
        const { source, ...fields } = input;
        Object.assign(instances.get(name), { ...fields, ...ignore[name], source });
        return { serviceInstanceUpdate: true };
      },
    ],
    [
      QUERIES.deploy,
      ({ serviceId }) => {
        const name = serviceId.slice(4);
        const id = `dep-${name}-${deployments.size}`;
        log.push(`deploy ${name}`);
        deployments.set(id, { name, polls: 0 });
        instances.get(name).latestDeployment = { id, status: "INITIALIZING" };
        return { serviceInstanceDeployV2: id };
      },
    ],
    [
      QUERIES.deployment,
      ({ id }) => {
        const dep = deployments.get(id);
        const sequence = statuses[dep.name] ?? ["DEPLOYING", "SUCCESS"];
        const status = sequence[Math.min(dep.polls++, sequence.length - 1)];
        log.push(`poll ${dep.name} ${status}`);
        instances.get(dep.name).latestDeployment = { id, status };
        return { deployment: { id, status } };
      },
    ],
  ];
  const fetch = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    const handler = handlers.find(([text]) => text === query);
    if (!handler) return new Response(JSON.stringify({ errors: [{ message: "unknown query" }] }), { status: 200 });
    return new Response(JSON.stringify({ data: handler[1](variables) }), { status: 200 });
  };
  return { fetch, log, instances, statuses, calls: () => log.filter((l) => !l.startsWith("poll")) };
}

/** Runs main() with a fake clock whose sleep() advances time, capturing output lines. */
export function harness(railway, extraEnv = {}) {
  const lines = [];
  const errors = [];
  let clock = Date.parse("2026-10-09T10:00:00Z");
  return {
    lines,
    errors,
    deps: {
      fetch: railway?.fetch,
      out: (l) => lines.push(l),
      err: (l) => errors.push(l),
      sleep: async (ms) => void (clock += ms),
      clientSleep: async () => {},
      now: () => clock,
    },
    env: { RAILWAY_TOKEN: "test-token", ...extraEnv },
  };
}
