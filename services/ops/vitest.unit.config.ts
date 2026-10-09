// Unit-only Vitest config used by Stryker (mutation runs never need Docker). Self-contained on purpose:
// Stryker copies the package into a sandbox, so it must not import files outside the package.
import { defineConfig } from "vitest/config";

const conditions = ["@kr/source"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.int.test.ts", "src/**/*.contract.test.ts", "**/node_modules/**"],
    environment: "node",
  },
});
