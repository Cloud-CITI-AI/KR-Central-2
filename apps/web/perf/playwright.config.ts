// Web-vitals project (WP-22): LCP, CLS and an INP proxy for the dashboard and the tracker on a throttled profile, run on the
// WP-19 harness (e2e/global-setup.ts starts the synthetic stack; `pnpm build` first). Own config so the functional suite never
// pays for it and its CPU/network throttling never leaks into functional tests:
//   pnpm --filter @kr/web exec playwright test -c perf/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { MAIN_WEB_URL } from "../e2e/harness/constants";
import { PROFILE } from "./budgets";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results/perf",
  globalSetup: "../e2e/global-setup.ts",
  // One page at a time: parallel loads would compete for the CPU being measured.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 300_000,
  // The json report carries each scenario's raw samples (an attachment), the evidence for what to optimise.
  reporter: [
    ...(process.env.CI ? [["github"] as const] : []),
    ["list"],
    ["json", { outputFile: "../test-results/perf/results.json" }],
  ],
  use: {
    baseURL: MAIN_WEB_URL,
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: "web-vitals", use: { ...devices["Desktop Chrome"], viewport: PROFILE.viewport } }],
});
