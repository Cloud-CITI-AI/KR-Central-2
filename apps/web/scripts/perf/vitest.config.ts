// `pnpm exec vitest run -c scripts/perf/vitest.config.ts` from apps/web: plain Node scripts, so no jsdom.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/perf/**/*.test.ts"],
    root: new URL("../..", import.meta.url).pathname,
  },
});
