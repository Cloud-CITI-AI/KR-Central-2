// Playbook templates/backend-node/stryker.config.mjs (thresholds docs/06: break 60, target 75+)
import { runnerSettings } from "../../stryker.shared.mjs";

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...runnerSettings("vitest.unit.config.ts"),
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  incremental: true,
  incrementalFile: ".stryker-tmp/incremental.json",
  // src/s3.ts is an I/O adapter covered only by the integration project (s3mock); mutating it against unit tests
  // alone would only report survivors (same rule as scripts/ci/mutation-targets.mjs for http/data files).
  mutate: ["src/**/*.ts", "!src/**/*.test.ts", "!src/**/*.int.test.ts", "!src/gen/**", "!src/index.ts", "!src/s3.ts"],
  thresholds: { high: 80, low: 70, break: 60 },
  reporters: ["clear-text", "progress", "html", "json"],
};
