// `pnpm exec vitest run -c scripts/perf/vitest.config.ts` from apps/web: the budget scripts and perf/ maths are plain Node, so no jsdom.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/perf/**/*.test.ts", "perf/**/*.test.ts"],
    root: new URL("../..", import.meta.url).pathname,
  },
});
