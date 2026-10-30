"use client";
import { useEffect, useState, type RefObject } from "react";

/** How far outside the scroller (as a share of its height) a page starts drawing. */
export const DRAW_MARGIN = "100% 0px";
/** How far outside the scroller a drawn page may be before its canvas is released: wider than `DRAW_MARGIN`, so a page at the edge does not flicker. */
export const RELEASE_MARGIN = "200% 0px";

/**
 * True while `target` is within `DRAW_MARGIN` of the visible part of `scroller`, and until it has moved beyond
 * `RELEASE_MARGIN` (two IntersectionObservers on the scroller as root, because the root margin only widens the root, not
 * clipping ancestors). Without IntersectionObserver the answer is always true, so content is still shown.
 */
export function useNearViewport(target: RefObject<Element | null>, scroller: RefObject<Element | null>): boolean {
  const supported = typeof IntersectionObserver !== "undefined";
  const [near, setNear] = useState(!supported);

  useEffect(() => {
    const element = target.current;
    // Checked again here: the API can go away between render and effect (test teardown removes stubbed globals first).
    if (!supported || typeof IntersectionObserver === "undefined" || !element) return;
    const root = scroller.current;
    const latest = (entries: IntersectionObserverEntry[]) => entries[entries.length - 1];
    const approach = new IntersectionObserver(
      (entries) => {
        if (latest(entries)?.isIntersecting) setNear(true);
      },
      { root, rootMargin: DRAW_MARGIN },
    );
    const leave = new IntersectionObserver(
      (entries) => {
        if (latest(entries)?.isIntersecting === false) setNear(false);
      },
      { root, rootMargin: RELEASE_MARGIN },
    );
    approach.observe(element);
    leave.observe(element);
    return () => {
      approach.disconnect();
      leave.disconnect();
    };
  }, [supported, target, scroller]);

  return near;
}
