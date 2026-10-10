import type { Page } from "@playwright/test";
import type { RawVitals } from "./vitals-math";

declare global {
  interface Window {
    __kr_vitals?: { lcp: number[]; shifts: RawVitals["layoutShifts"][number][]; events: RawVitals["events"][number][] };
  }
}

/**
 * Starts recording LCP candidates, layout shifts and Event Timing entries before any page script runs (buffered
 * observers, so entries from before the observer started are included). Call before `page.goto`.
 */
export async function installCollector(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store: NonNullable<Window["__kr_vitals"]> = { lcp: [], shifts: [], events: [] };
    window.__kr_vitals = store;
    const observe = (type: string, onEntry: (entry: PerformanceEntry) => void, extra: Record<string, unknown> = {}) => {
      try {
        new PerformanceObserver((list) => {
          list.getEntries().forEach(onEntry);
        }).observe({ type, buffered: true, ...extra });
      } catch {
        // an entry type this browser does not report stays empty and is flagged by the budget check
      }
    };
    observe("largest-contentful-paint", (entry) => store.lcp.push(entry.startTime));
    observe("layout-shift", (entry) => {
      const shift = entry as PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
        sources?: { node: Node | null }[];
      };
      const sources = (shift.sources ?? []).map(({ node }) =>
        node instanceof Element
          ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}.${(node.getAttribute("class") ?? "").slice(0, 60)}`
          : "?",
      );
      store.shifts.push({
        startTime: shift.startTime,
        value: shift.value,
        hadRecentInput: shift.hadRecentInput,
        sources,
      });
    });
    observe(
      "event",
      (entry) => {
        const event = entry as PerformanceEntry & { interactionId?: number };
        store.events.push({
          interactionId: event.interactionId ?? 0,
          startTime: event.startTime,
          duration: event.duration,
        });
      },
      { durationThreshold: 16 },
    );
  });
}

/** What has been recorded so far. */
export async function readRaw(page: Page): Promise<RawVitals> {
  const store = await page.evaluate(() => window.__kr_vitals ?? { lcp: [], shifts: [], events: [] });
  return { lcpStartTimes: store.lcp, layoutShifts: store.shifts, events: store.events };
}
