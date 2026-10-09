// Playbook templates/frontend/vitest.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { coverageDefaults, sourceConditions } from "../../vitest.shared.ts";

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: sourceConditions, tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    coverage: { ...coverageDefaults, exclude: [...coverageDefaults.exclude, "src/**/*.stories.tsx", "src/test/**"] },
  },
});
