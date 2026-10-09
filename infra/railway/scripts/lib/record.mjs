/**
 * Rollback record (previous-<env>.json): the state each service was in before a deploy touched it, written before the
 * first change so deploy.yml's failure step can restore it with `--rollback`. Holds image references and settings only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ConfigurationError, DIGEST_REF, SERVICE_ORDER, diffState, stateFromInstance } from "./settings.mjs";

export function writeRecord(file, environment, nowMs, entries) {
  const services = entries.map(({ name, serviceId, instance }) => ({
    name,
    serviceId,
    state: stateFromInstance(instance),
  }));
  const record = { version: 1, environment, recordedAt: new Date(nowMs).toISOString(), services };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

/** Targets that put each recorded service back to its recorded state, in deployment order. */
export function rollbackTargets(file, environment, requested, log = () => {}) {
  let record;
  try {
    record = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigurationError(`Cannot read rollback record ${file}: ${error.message}`);
  }
  if (record?.version !== 1 || record.environment !== environment || !Array.isArray(record.services)) {
    throw new ConfigurationError(`${file} is not a version 1 record for environment ${environment}`);
  }
  const byName = new Map(record.services.map((entry) => [entry.name, entry]));
  return (requested ?? SERVICE_ORDER.filter((name) => byName.has(name))).flatMap((name) => {
    const entry = byName.get(name);
    if (entry === undefined) throw new ConfigurationError(`${file} has no record for ${name}`);
    const image = entry.state?.image;
    if (image == null) return []; // never deployed before this run: nothing to go back to
    if (!DIGEST_REF.test(image)) {
      // a placeholder or tag (e.g. `:latest` from setup) is mutable and unattested: never redeploy it
      log(
        `[${name}] recorded image ${image} is not a ghcr.io digest reference; treated as no previous image, left alone`,
      );
      return [];
    }
    return [{ name, settings: { cronSchedule: entry.state.cronSchedule }, state: entry.state, rollback: true }];
  });
}

/** A service the failed run never reached is still on its recorded state and healthy: leave it alone. */
export function alreadyRolledBack(target, instance) {
  return (
    diffState(target.state, stateFromInstance(instance)).length === 0 && instance.latestDeployment?.status === "SUCCESS"
  );
}
