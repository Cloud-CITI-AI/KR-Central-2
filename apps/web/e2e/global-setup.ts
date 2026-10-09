import { writeFileSync } from "node:fs";
import { STACK_INFO_ENV } from "./harness/constants";
import { seedPeople } from "./harness/seed";
import { startStack } from "./harness/stack";
import { MAIN_WEB_PORT } from "./harness/constants";

/**
 * Starts the synthetic stack once for the whole run and hands it to the test workers through an environment variable
 * (workers are spawned after this returns, so they inherit it). The returned function tears everything down; the harness
 * also reaps leftovers of a run that died without running it (harness/lifecycle.ts).
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await startStack({ label: "main", webPort: MAIN_WEB_PORT, control: true });
  try {
    await seedPeople(stack.info);
  } catch (error) {
    await stack.stop();
    throw error;
  }
  process.env[STACK_INFO_ENV] = JSON.stringify(stack.info);
  writeFileSync(`${stack.info.logDir}/stack.json`, JSON.stringify(stack.info, null, 2));
  return async () => {
    await stack.stop();
  };
}
