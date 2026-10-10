// Pure maths on the raw browser entries collected by vitals-collector.ts, so it is unit-tested without a browser.

export interface LayoutShiftEntry {
  readonly startTime: number;
  readonly value: number;
  readonly hadRecentInput: boolean;
  /** The elements that moved (tag, id/class), to tell what to fix; not used by the maths. */
  readonly sources?: readonly string[];
}
export interface EventEntry {
  readonly interactionId: number;
  readonly startTime: number;
  readonly duration: number;
}
export interface RawVitals {
  /** `startTime` of every largest-contentful-paint candidate, in order; the last one is the LCP. */
  readonly lcpStartTimes: readonly number[];
  readonly layoutShifts: readonly LayoutShiftEntry[];
  readonly events: readonly EventEntry[];
}
export interface Vitals {
  readonly lcpMs: number | null;
  readonly cls: number;
  /** The worst interaction latency, or null when nothing was interacted with. */
  readonly inpMs: number | null;
}

/** CLS: the largest "session window" of shifts (gaps under 1 s, at most 5 s long), ignoring shifts right after input. */
export function cumulativeLayoutShift(shifts: readonly LayoutShiftEntry[]): number {
  let largest = 0;
  let windowValue = 0;
  let windowStart = 0;
  let previous = 0;
  for (const shift of shifts.filter((s) => !s.hadRecentInput)) {
    const continues = windowValue > 0 && shift.startTime - previous < 1000 && shift.startTime - windowStart < 5000;
    if (!continues) {
      windowValue = 0;
      windowStart = shift.startTime;
    }
    windowValue += shift.value;
    previous = shift.startTime;
    largest = Math.max(largest, windowValue);
  }
  return largest;
}

/**
 * INP: an interaction's latency is the longest event sharing its interactionId; the page's INP is the worst interaction,
 * or the 98th percentile once there are 50 or more (web.dev). This is the proxy for the scripted interactions in the run.
 */
export function interactionToNextPaint(events: readonly EventEntry[]): number | null {
  const longest = new Map<number, number>();
  for (const event of events) {
    if (event.interactionId > 0)
      longest.set(event.interactionId, Math.max(longest.get(event.interactionId) ?? 0, event.duration));
  }
  if (longest.size === 0) return null;
  const sorted = [...longest.values()].sort((a, b) => b - a);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 50))] ?? null;
}

export function summarise(raw: RawVitals): Vitals {
  return {
    lcpMs: raw.lcpStartTimes.at(-1) ?? null,
    cls: cumulativeLayoutShift(raw.layoutShifts),
    inpMs: interactionToNextPaint(raw.events),
  };
}

/** Nearest-rank percentile (p in 0..100) of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error("percentile of no samples");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

export interface Budgets {
  readonly lcpMs: number;
  readonly inpMs: number;
  readonly cls: number;
}

/**
 * Each metric's p75 over the samples, judged against `budgets`, or against `ceilings` where a metric has one (a known
 * breach). A metric with no samples cannot pass. `reclaimable` lists ceilings whose metric already fits its budget.
 */
export function judge(
  samples: readonly Vitals[],
  budgets: Budgets,
  ceilings: Partial<Budgets> = {},
): { p75: Vitals; breaches: string[]; reclaimable: string[] } {
  const p75Of = (pick: (v: Vitals) => number | null): number | null => {
    const values = samples.map(pick).filter((v): v is number => v !== null);
    return values.length === 0 ? null : percentile(values, 75);
  };
  const p75: Vitals = { lcpMs: p75Of((v) => v.lcpMs), cls: p75Of((v) => v.cls) ?? 0, inpMs: p75Of((v) => v.inpMs) };
  const breaches: string[] = [];
  const reclaimable: string[] = [];
  const check = (label: string, value: number | null, key: keyof Budgets, unit: string, digits: number): void => {
    if (value === null) {
      breaches.push(`${label} was never reported`);
      return;
    }
    const ceiling = ceilings[key];
    const limit = ceiling ?? budgets[key];
    const shown = (n: number) => `${n.toFixed(digits)}${unit}`;
    if (value > limit) {
      breaches.push(
        `${label} p75 ${shown(value)} > ${shown(limit)}${ceiling === undefined ? "" : ` (known-breach ceiling; budget ${shown(budgets[key])})`}`,
      );
    } else if (ceiling !== undefined && value <= budgets[key]) {
      reclaimable.push(
        `${label} p75 ${shown(value)} fits its budget ${shown(budgets[key])} this run: remove its KNOWN_BREACHES entry if it keeps doing so`,
      );
    }
  };
  check("LCP", p75.lcpMs, "lcpMs", " ms", 0);
  check("CLS", p75.cls, "cls", "", 3);
  check("INP proxy", p75.inpMs, "inpMs", " ms", 0);
  return { p75, breaches, reclaimable };
}
