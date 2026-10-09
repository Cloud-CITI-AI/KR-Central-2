// Playbook templates/backend-node/stryker.config.mjs — domain logic is where mutation score matters most.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts", project: "unit" },
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: ".stryker-tmp/incremental.json",
  mutate: ["src/**/domain/**/*.ts", "!src/**/*.test.ts"],
  thresholds: { high: 80, low: 70, break: 60 },
  reporters: ["clear-text", "progress", "html", "json"],
};
