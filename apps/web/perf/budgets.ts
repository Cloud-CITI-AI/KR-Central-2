import type { Budgets } from "./vitals-math";

/**
 * Web-vitals budgets (PRODUCT_SPEC section 14, FE-9): LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1, judged at the 75th
 * percentile of the samples taken on the reference profile below.
 */
export const BUDGETS: Budgets = { lcpMs: 2500, inpMs: 200, cls: 0.1 };

export type Scenario = "dashboard" | "tracker";

/**
 * Metrics that are over budget today, with the p75 ceiling each may not exceed (product code: reported to the orchestrator,
 * not optimised here). Same ratchet as BUDGET_WAIVERS for bundles: lower a ceiling when the page improves, delete it when
 * the page is within budget (the run prints a note when a waived metric already fits). `PERF_STRICT=1` ignores them.
 * Measured on the reference profile, 5 samples (2026-10-10), ceilings are the worst p75 seen plus about 20 %:
 *  - dashboard: LCP 3.7 to 3.8 s; CLS 0.09 to 0.17 (grid, chips and summary box move as the job cards arrive, whatever the profile).
 *  - tracker: LCP 3.7 to 4.1 s; CLS 0.654 (main wrap and footer shift at first render, whatever the profile);
 *    INP proxy 0.35 to 0.51 s (the "Expand all" click renders every stage at once).
 */
export const KNOWN_BREACHES: Readonly<Record<Scenario, Partial<Budgets>>> = {
  dashboard: { lcpMs: 4600, cls: 0.22 },
  tracker: { lcpMs: 5000, cls: 0.7, inpMs: 650 },
};

/**
 * The reference profile: Lighthouse's "Slow 4G" network (1.6 Mbit/s down, 750 kbit/s up, 150 ms round trip) and a 4x CPU
 * slowdown, in a cold browser context (nothing cached) on a 1280 x 800 desktop viewport. Sample count is `PERF_RUNS`.
 * `PERF_LATENCY_MS`, `PERF_DOWN_KBPS`, `PERF_UP_KBPS` and `PERF_CPU` override it to investigate; CI uses the defaults.
 */
const hasOverride = ["PERF_LATENCY_MS", "PERF_DOWN_KBPS", "PERF_UP_KBPS", "PERF_CPU"].some((n) => process.env[n]);
const env = (name: string, fallback: number): number => Number(process.env[name] ?? fallback);
export const PROFILE = {
  name: hasOverride ? "custom profile (PERF_* overrides)" : "Slow 4G, 4x CPU slowdown, cold cache, 1280 x 800",
  latencyMs: env("PERF_LATENCY_MS", 150),
  downloadBytesPerSecond: (env("PERF_DOWN_KBPS", 1600) * 1000) / 8,
  uploadBytesPerSecond: (env("PERF_UP_KBPS", 750) * 1000) / 8,
  cpuSlowdown: env("PERF_CPU", 4),
  viewport: { width: 1280, height: 800 },
} as const;

/** How many cold loads of each page are measured; the budget is checked on their 75th percentile. */
export const SAMPLES = Math.max(1, Number(process.env.PERF_RUNS ?? 5));
