// Playbook templates/frontend/stryker.config.mjs — mutate logic, not markup.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: ".stryker-tmp/incremental.json",
  mutate: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/**/*.stories.tsx",
    "!src/gen/**",
    "!src/app/**/page.tsx",
    "!src/app/**/layout.tsx",
    "!src/test/**",
  ],
  thresholds: { high: 80, low: 70, break: 60 },
  reporters: ["clear-text", "progress", "html", "json"],
};
