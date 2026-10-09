// Playbook templates/frontend/stryker.config.mjs — mutate logic, not markup.
import { runnerSettings } from "../../stryker.shared.mjs";

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...runnerSettings("vitest.unit.config.ts"),
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  // Stryker's default also puts `// @ts-nocheck` on every .js/.mjs file it can reach, including the vendored pdf.js
  // runtime in public/pdfjs, and pdfjs-assets.test.ts asserts those files are byte for byte the installed pdfjs-dist, so
  // the initial dry run would fail. Limit the type-check disabling to the sources that are mutated.
  disableTypeChecks: "src/**/*.{js,ts,jsx,tsx,mjs,cjs,mts,cts}",
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
