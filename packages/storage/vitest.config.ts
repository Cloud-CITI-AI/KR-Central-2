import { defineConfig } from "vitest/config";
import { coverageDefaults, resolveDefaults, ssrDefaults } from "../../vitest.shared.ts";

export default defineConfig({
  resolve: resolveDefaults,
  ssr: ssrDefaults,
  test: {
    coverage: coverageDefaults,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts", "src/**/*.contract.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        // S3 adapter tests against adobe/s3mock via Testcontainers (WP-06); no global setup needed.
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts", "test/**/*.int.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 180_000,
          pool: "forks",
        },
      },
    ],
  },
});
