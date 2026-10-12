// Playbook templates/frontend/vitest.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { coverageDefaults, sourceConditions, ssrDefaults } from "../../vitest.shared.ts";

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: sourceConditions, tsconfigPaths: true },
  // Node-environment tests (server components, route handlers) resolve workspace packages through SSR: without this they
  // load @kr/* from a possibly stale or missing dist/ instead of the TypeScript source.
  ssr: ssrDefaults,
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    coverage: { ...coverageDefaults, exclude: [...coverageDefaults.exclude, "src/**/*.stories.tsx", "src/test/**"] },
  },
});
