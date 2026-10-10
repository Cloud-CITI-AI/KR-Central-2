// k6 API smoke driver (WP-22): starts the same synthetic stack as the web-vitals project, signs in as staff through the
// harness, seeds jobs and runs services/api/load/smoke.js against the API with k6 (or the grafana/k6 image):
//   pnpm --filter @kr/web exec playwright test -c perf/k6.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "k6-smoke.spec.ts",
  outputDir: "../test-results/perf-k6",
  globalSetup: "../e2e/global-setup.ts",
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 300_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
});
