// Unit-only Vitest config used by Stryker. Self-contained on purpose: Stryker copies the package into a sandbox,
// so it must not import files outside the package (vitest.config.ts imports ../../vitest.shared.ts).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const conditions = ["@kr/source"];

export default defineConfig({
  plugins: [react()],
  resolve: { conditions, tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
