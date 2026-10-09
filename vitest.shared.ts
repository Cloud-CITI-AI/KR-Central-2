// Shared Vitest settings. Packages import this from their own vitest.config.ts.
// "@kr/source" makes workspace packages resolve to TypeScript source (no prior build needed for tests).
import type { UserConfig } from "vitest/config";

export const sourceConditions = ["@kr/source"];

export const coverageDefaults = {
  provider: "v8" as const,
  reporter: ["text-summary", "cobertura", "html"],
  reportsDirectory: "coverage",
  exclude: [
    "src/gen/**",
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.int.test.ts",
    "**/*.contract.test.ts",
    "test/**",
    "dist/**",
  ],
};

export const resolveDefaults: UserConfig["resolve"] = { conditions: sourceConditions };
export const ssrDefaults: UserConfig["ssr"] = {
  resolve: { conditions: sourceConditions, externalConditions: sourceConditions },
};
