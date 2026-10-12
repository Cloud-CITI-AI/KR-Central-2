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
 *  - tracker: LCP 3.4 to 4.1 s over the runs below (before and after the tracker fixes alike). The LCP element is the header's hero
 *    photo (hero-header-bg.jpg, 1800 x 1200, 276 KB over a 1.6 Mbit/s line), not anything the tracker
 *    renders: it can only come within 2.5 s through the bundle (FIX-R1-WEBCLIENT) and the header image (resize to the 1280 px
 *    it is shown at, or preload it), both outside the tracker. CLS is within budget since the skeleton that holds the
 *    tracker's place (was 0.654: one shift of main and footer when "Loading job" was replaced), so it has no waiver. Expand all
 *    itself is now 80 to 110 ms (was 0.54 to 0.76 s: the stage bodies are memoised and shown a stage per frame); the INP proxy
 *    (the worst of Expand all, ticking a checkpoint and Collapse all) is 0.15 to 0.25 s (p75 0.18 to 0.24 s over two runs) because
 *    the next click can land while the 46 cards re-render for the saved status (the cards take the whole job as a prop).
 */
export const KNOWN_BREACHES: Readonly<Record<Scenario, Partial<Budgets>>> = {
  dashboard: { lcpMs: 4600, cls: 0.22 }, // LCP 3.7 to 3.9 s, CLS 0.09 to 0.17 measured, owner: WP-24
  tracker: { lcpMs: 4900, inpMs: 300 }, // LCP p75 3.7 to 4.1 s (the hero photo; worst 4044 ms plus 20 %), INP p75 0.18 to 0.24 s (ceiling 0.30 s); owner: FIX-R1-WEBCLIENT and the header
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
