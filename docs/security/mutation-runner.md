# Mutation testing: runner re-check and timings (2026-10-09)

Question from WP-20: does a `@stryker-mutator/vitest-runner` release older than 24 hours support Vitest 5, so that
`stryker.shared.mjs` can leave the `command` runner? And does mutation of a PR's changed files
(`scripts/ci/mutation-targets.mjs`) stay under 10 minutes for a typical PR?

**Answers.** (1) No: the newest release is still 10.0.0 and it does not work with Vitest 5.0.3. The command runner stays;
the trade-off is documented at the top of `stryker.shared.mjs`. (2) Yes for 1 to 3 changed files in every package that can
run mutation; for five large `services/api` domain files only with two opt-ins added in this change; and two CI problems
(D-4, D-5 in `findings.md`) stop mutation from running in `services/api` at all today.

## 1. Is there a vitest-runner that works with Vitest 5?

| Check                                                                               | Result                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm view @stryker-mutator/vitest-runner time`                                      | Latest 10.0.0, published 2026-08-14 (the version installed). No later release, no pre-release dist-tag. Peer range `vitest >=2.0.0`, so it installs but is not tested against 5. |
| Run on `packages/workflow`, same tests and mutants, vitest runner vs command runner | Table below. The vitest runner finishes, reports no error and kills almost nothing.                                                                                              |

`packages/workflow`, 3 files, 426 mutants (136 are TypeScript compile errors dropped by the checker in both runs), the
unit tests of the package:

| Runner                          | Score | Killed | Survived | No coverage | Wall time  |
| ------------------------------- | ----- | ------ | -------- | ----------- | ---------- |
| `command` (current)             | 80.00 | 232    | 58       | 0           | 6 min 17 s |
| `vitest` 10.0.0 on Vitest 5.0.3 | 3.10  | 9      | 273      | 8           | 3 min 24 s |

The vitest runner is faster only because nothing it runs can fail. Probable cause (read from the plugin, not confirmed
upstream): `vitest-test-runner.js` hands the active mutant to the workers with `ctx.provide('activeMutant', id)` and
`stryker-setup.js` reads it back with `inject('activeMutant')`; under Vitest 5 the value evidently never reaches the test
workers, so no mutant is ever switched on. Repeat the comparison before any switch (section 4).

## 2. Timings of changed-file mutation (command runner)

Machine: 4 vCPU shared with other agents, **load average 10 to 29 during every run** (so wall times are pessimistic, and
Stryker's timeout classification is unreliable at the top of the range). Command in CI form:
`pnpm exec stryker run --incremental --mutate "<changed files>"` from a clean `.stryker-tmp` (cold; CI has no cache).

| Package, changed files (all domain or rules code)                                       | Mutants | Score  | Wall time   | Notes                                                          |
| --------------------------------------------------------------------------------------- | ------- | ------ | ----------- | -------------------------------------------------------------- |
| `packages/workflow`, the whole package (`dates`, `presentation`, `rules`)               | 426     | 80.00  | 6 min 17 s  | the `verify` command; exit 0                                   |
| `services/worker`, 5 domain files (all of `src/domain`)                                 | 119     | 100.00 | 1 min 43 s  | exit 0                                                         |
| `packages/document-parsing`, `rules/conformed.ts` + `rules/dates.ts`                    | 160     | 96.49  | 5 min 33 s  | 87 timeouts (looping mutants wait for the timeout)             |
| `services/api`, `users/domain/cursor.ts` + `user-view.ts` (commit d3a7dd5), `--inPlace` | 17      | 75.00  | 1 min 3 s   | needs `--inPlace` (D-5)                                        |
| `services/api`, 5 domain files of about 500 lines, `--inPlace`                          | 447     | 100.00 | 20 min 17 s | **not valid**: 234 of 242 verdicts are timeouts caused by load |
| same, with the opt-ins `{ isolate: false, inPlace: true }`                              | 447     | 97.11  | 13 min 37 s | **not valid for timing** (163 timeouts, load 17 to 29)         |

How big is a typical PR? In the last 80 commits that touched `services/api/src/modules`, 11 of the first 12 that changed
domain code changed one mutated file and one changed two. So a typical PR changes one or two mutated files, which is less than any of the
whole-package runs in the first three rows (6 min 17 s, 1 min 43 s, 5 min 33 s): under 6.5 minutes even on this
oversubscribed machine.

The last two rows are why the load matters: a mutant counts as "killed by timeout" when its test run exceeds the timeout,
and at load 17 to 29 ordinary runs do. For `services/api` the per-run cost is better measured in CPU time, which load inflates far less than
wall time: one run of the unit suite (`vitest run --config vitest.unit.config.ts --silent`) uses **12.3 to 13.5 CPU
seconds** (4.8 to 8.5 s wall), and **5.4 to 6.2 CPU seconds** with `--no-isolate` (3.0 to 3.5 s wall), 344 tests passing
either way. With 242 evaluated mutants (the other 205 are compile errors) that is about 50 CPU minutes by default and
about 23 with the opt-in; on four idle vCPUs, plus the checker and start-up, **roughly 14 to 15 minutes by default and
about 7 with the opt-in**. These two figures are estimates, not measurements on an idle machine.

Conclusion for the 10-minute budget: confirmed (measured) for PRs that change one to three mutated files in any package;
for a PR that changes five large `services/api` domain files, not confirmed without the opt-ins and estimated at about 7
minutes with them. The CI job has 25 minutes in total (`timeout-minutes: 25`) and also runs lint, typecheck, unit and
integration tests first, so a 14-minute mutation step could time the job out.

## 3. What changed, and what is proposed

- `stryker.shared.mjs`: the comment records this re-check, and `runnerSettings(vitestConfig, options)` takes two opt-ins,
  both off by default (the returned settings are identical to before for every existing config):
  `isolate: false` adds `--no-isolate` (about 2.3 times less CPU per run; it fails the unit tests of
  `packages/document-parsing` and `apps/web`, so it is a per-package choice), and `inPlace: true` mutates the checkout
  instead of a copy.
- Proposed, not done (outside the owned paths): `services/api/stryker.config.mjs` uses
  `...runnerSettings("vitest.unit.config.ts", { inPlace: true, isolate: false })` (fixes D-5 and halves the run time);
  `.github/workflows/reusable-ci-node.yml` drops `--thresholds.break "$BREAK"` (D-4).

## 4. How to repeat the comparison

```sh
npm view @stryker-mutator/vitest-runner version time --json | tail -5      # newer than 10.0.0?
cd packages/workflow && rm -rf .stryker-tmp
time pnpm exec stryker run                                                  # command runner (80.00 on 2026-10-09)
# vitest runner: the same config with these settings in place of runnerSettings()
#   testRunner: "vitest", vitest: { configFile: "vitest.unit.config.ts" }, coverageAnalysis: "perTest",
#   plugins: [require.resolve("@stryker-mutator/vitest-runner"), require.resolve("@stryker-mutator/typescript-checker")]
time pnpm exec stryker run <that config>
```

Switch only if the vitest runner's score is within a few points of the command runner's on `packages/workflow` and the
killed counts match; then remove the `command` runner from `stryker.shared.mjs`.
