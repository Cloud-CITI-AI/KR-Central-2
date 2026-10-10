// End-to-end, accessibility, visual and prototype-parity suite (WP-19). `e2e/global-setup.ts` starts the whole synthetic
// stack (Postgres, mock Entra, S3 mock, API, worker, `next start`), so there is no webServer entry: run `pnpm build` first.
import { defineConfig, devices } from "@playwright/test";
import { MAIN_WEB_URL } from "./e2e/harness/constants";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Flake detection, not flake hiding: a test that passes on retry is reported as flaky (ci.yml warns on it).
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]]
    : "list",
  use: {
    baseURL: MAIN_WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Sandboxes without a downloadable browser can point at a preinstalled Chromium (CI installs the pinned one).
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}),
  },
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/\.mobile\.spec\.ts$/, /\/clamav\//],
    },
    {
      name: "mobile",
      // 390 px wide is the prototype's phone reference (PRODUCT_SPEC §12).
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
      testMatch: [/shell\.spec\.ts$/, /\.mobile\.spec\.ts$/],
    },
    {
      // The one project whose stack scans with the real ClamAV container (it takes a minute to load its signatures).
      name: "clamav",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /\/clamav\/.*\.spec\.ts$/,
      timeout: 240_000,
    },
  ],
});
