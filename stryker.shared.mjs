// Shared Stryker settings.
//
// Why the "command" runner: @stryker-mutator/vitest-runner does not activate mutants under Vitest 5, so every runtime
// mutant "survives" and the score is meaningless. Re-checked 2026-10-09 (WP-20, record in docs/security/mutation-runner.md):
//   - npm has no release newer than 10.0.0 (published 2026-08-14) and no pre-release tag; its peer range (vitest >= 2)
//     lets it install, which is why the failure is silent.
//   - packages/workflow, same tests, same mutants (426, 136 of them compile errors the TypeScript checker drops):
//     vitest runner 3.10 % (9 killed, 273 survived, 8 no coverage) in 3 min 24 s;
//     command runner 80.00 % (232 killed, 58 survived) in 6 min 17 s.
// Until a release fixes this we run each mutant through the Vitest CLI. It is slower (no per-test coverage, the whole unit
// suite per mutant), which is acceptable because CI mutates only the files a PR changes (scripts/ci/mutation-targets.mjs).
// Typical-PR timings and two CI problems found while measuring them (D-4, D-5): docs/security/findings.md.
// Revisit when `npm view @stryker-mutator/vitest-runner version` is above 10.0.0: repeat the packages/workflow comparison
// of docs/security/mutation-runner.md and switch only if the vitest runner scores within a few points of the command runner.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * @param {string} vitestConfig Vitest config file (relative to the package) that runs unit tests only.
 * @param {object} [options] Opt-ins for a package whose tests allow them (docs/security/mutation-runner.md); the defaults
 *   keep today's behaviour for every package.
 * @param {boolean} [options.isolate] false adds `--no-isolate`: Vitest reuses workers across test files, roughly halving the
 *   CPU time of one run (services/api: about 13 s to 6 s). It breaks packages/document-parsing and apps/web, so it is opt-in.
 * @param {boolean} [options.inPlace] true mutates the checkout itself instead of a copy under `.stryker-tmp/sandbox-*`. Needed
 *   by a package whose tests read files by a path relative to their own location (services/api: finding D-5). Stryker restores
 *   the files afterwards; use it in CI (a clean checkout), not on a developer's working tree.
 */
export function runnerSettings(vitestConfig = "vitest.unit.config.ts", options = {}) {
  const { isolate = true, inPlace = false } = options;
  return {
    // Plugins are resolved to absolute paths because pnpm's isolated node_modules hides root devDependencies
    // from @stryker-mutator/core's own plugin discovery.
    plugins: [require.resolve("@stryker-mutator/typescript-checker")],
    testRunner: "command",
    commandRunner: { command: `vitest run --config ${vitestConfig} --silent${isolate ? "" : " --no-isolate"}` },
    coverageAnalysis: "off",
    ...(inPlace ? { inPlace: true } : {}),
  };
}
