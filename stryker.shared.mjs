// Shared Stryker settings.
//
// Why the "command" runner: @stryker-mutator/vitest-runner 10.0.0 does not activate mutants under Vitest 5
// (verified 2026-10-09: every runtime mutant "survived", score 4% vs 84% with the command runner on the same
// tests). Until the vitest runner supports Vitest 5 we run each mutant through the Vitest CLI. It is slower
// (no per-test coverage), which is acceptable because CI mutates only the files a PR changes.
// Revisit: docs/plan/WORK_PACKAGES.md WP-20 / open risk "Stryker + Vitest 5".
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @param {string} vitestConfig Vitest config file (relative to the package) that runs unit tests only. */
export function runnerSettings(vitestConfig = "vitest.unit.config.ts") {
  return {
    // Plugins are resolved to absolute paths because pnpm's isolated node_modules hides root devDependencies
    // from @stryker-mutator/core's own plugin discovery.
    plugins: [require.resolve("@stryker-mutator/typescript-checker")],
    testRunner: "command",
    commandRunner: { command: `vitest run --config ${vitestConfig} --silent` },
    coverageAnalysis: "off",
  };
}
