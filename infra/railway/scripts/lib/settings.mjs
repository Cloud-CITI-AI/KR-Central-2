/**
 * Service settings as code (ADR-0008): load and validate infra/railway/services/<service>.json, read the release's
 * image digests, map settings to Railway's ServiceInstanceUpdateInput, and compare what Railway reports (drift).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "./json-schema.mjs";

/** Deployment order (ADR-0008): new worker/web code must never run against an old schema, the api never holds DDL. */
export const SERVICE_ORDER = Object.freeze(["clamav", "migrate", "api", "worker", "web", "backup"]);

const servicesDir = new URL("../../services/", import.meta.url);
const schema = JSON.parse(readFileSync(new URL("../service.schema.json", servicesDir), "utf8"));
/** A tag can move; only an immutable digest reference is deployable (the attestation was verified for that digest). */
export const DIGEST_REF = /^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/;

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Parses "clamav migrate api" or "clamav,migrate"; refuses unknown names, duplicates and anything out of order. */
export function parseServices(value) {
  const names = value.split(/[\s,]+/).filter(Boolean);
  if (names.length === 0) throw new ConfigurationError("--services is empty");
  const positions = names.map((name) => SERVICE_ORDER.indexOf(name));
  const unknown = names.filter((_, i) => positions[i] === -1);
  if (unknown.length > 0) throw new ConfigurationError(`Unknown service(s): ${unknown.join(", ")}`);
  if (positions.some((p, i) => i > 0 && p <= positions[i - 1])) {
    throw new ConfigurationError(
      `Services must be listed once each in the deployment order: ${SERVICE_ORDER.join(" ")}`,
    );
  }
  return names;
}

export function loadSettings(name, dir = servicesDir) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
  } catch (error) {
    throw new ConfigurationError(`Cannot read settings for ${name}: ${error.message}`);
  }
  const problems = validate(schema, settings);
  if (problems.length > 0) throw new ConfigurationError(`Invalid settings for ${name}: ${problems.join("; ")}`);
  if (settings.service !== name) throw new ConfigurationError(`${name}.json describes service "${settings.service}"`);
  return settings;
}

/** Reads `image-<image>.txt` (written by release.yml) and returns the digest reference it holds. */
export function readImageRef(imagesDir, image) {
  const file = join(imagesDir, `image-${image}.txt`);
  let ref;
  try {
    ref = readFileSync(file, "utf8").trim();
  } catch (error) {
    throw new ConfigurationError(`Cannot read image-${image}.txt in ${imagesDir}: ${error.message}`);
  }
  if (!DIGEST_REF.test(ref))
    throw new ConfigurationError(`image-${image}.txt must hold ghcr.io/<repo>@sha256:<digest>`);
  return ref;
}

/** The comparable shape of a service instance: what the settings file declares plus the image. null means unset. */
export function desiredState(settings, imageRef) {
  const { healthcheck, restartPolicy } = settings;
  return {
    image: imageRef,
    startCommand: settings.startCommand,
    healthcheckPath: healthcheck?.path ?? null,
    healthcheckTimeout: healthcheck?.timeoutSeconds ?? null,
    restartPolicyType: restartPolicy.type,
    // Retries only mean something for ON_FAILURE; Railway reports null for the other policies.
    restartPolicyMaxRetries: restartPolicy.type === "ON_FAILURE" ? restartPolicy.maxRetries : null,
    cronSchedule: settings.cronSchedule,
    numReplicas: settings.replicas,
    sleepApplication: settings.sleepApplication,
  };
}

/** Normalises a `serviceInstance` query result to the same shape as desiredState. */
export function stateFromInstance(instance) {
  const value = (v) => v ?? null;
  return {
    image: value(instance.source?.image),
    startCommand: value(instance.startCommand),
    healthcheckPath: value(instance.healthcheckPath),
    healthcheckTimeout: value(instance.healthcheckTimeout),
    restartPolicyType: value(instance.restartPolicyType),
    restartPolicyMaxRetries:
      instance.restartPolicyType === "ON_FAILURE" ? value(instance.restartPolicyMaxRetries) : null,
    cronSchedule: value(instance.cronSchedule),
    numReplicas: value(instance.numReplicas),
    sleepApplication: instance.sleepApplication === true,
  };
}

/** The `serviceInstanceUpdate` input for a state; null clears a setting that the file leaves unset. */
export function toUpdateInput(state) {
  const { image, ...rest } = state;
  return { source: { image }, ...rest };
}

/** Differences between what is wanted and what Railway reports, as [{field, expected, actual}]. */
export function diffState(expected, actual) {
  return Object.keys(expected)
    .filter((field) => expected[field] !== actual[field])
    .map((field) => ({ field, expected: expected[field], actual: actual[field] ?? null }));
}

const FAILED = new Set(["FAILED", "CRASHED", "REMOVED", "REMOVING", "SKIPPED", "NEEDS_APPROVAL"]);

/**
 * Maps a Railway deployment status to healthy / failed / pending. Health-checked services are healthy at SUCCESS; a cron
 * service has no container to check, so it counts as healthy once SUCCESS or SLEEPING (UNVERIFIED, prove in staging).
 */
export function deploymentOutcome(status, settings) {
  if (status === "SUCCESS" || (settings.cronSchedule !== null && status === "SLEEPING")) return "healthy";
  return FAILED.has(status) ? "failed" : "pending";
}
