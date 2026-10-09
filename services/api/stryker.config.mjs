// Playbook templates/backend-node/stryker.config.mjs — domain logic is where mutation score matters most.
import { runnerSettings } from "../../stryker.shared.mjs";

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...runnerSettings("vitest.unit.config.ts"),
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  incremental: true,
  incrementalFile: ".stryker-tmp/incremental.json",
  mutate: ["src/**/domain/**/*.ts", "!src/**/*.test.ts"],
  thresholds: { high: 80, low: 70, break: 60 },
  reporters: ["clear-text", "progress", "html", "json"],
};
