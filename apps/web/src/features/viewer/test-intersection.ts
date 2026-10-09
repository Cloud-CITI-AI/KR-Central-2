import { act } from "@testing-library/react";
import { vi } from "vitest";
import { DRAW_MARGIN, RELEASE_MARGIN } from "./useNearViewport";

/** How far a page is from the visible part of the scroller: inside the draw margin, between the two margins, or beyond both. */
export type Zone = "near" | "between" | "far";

/** A controllable IntersectionObserver: nothing intersects until a test says where an element is. */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;
  readonly root: Element | null;
  readonly rootMargin: string;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.root = options.root instanceof Element ? options.root : null;
    this.rootMargin = options.rootMargin ?? "0px";
    FakeIntersectionObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }
  takeRecords() {
    return [];
  }
  report(element: Element, isIntersecting: boolean) {
    if (this.observed.has(element)) {
      this.callback(
        [{ target: element, isIntersecting } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
  }
}

/** Install the fake for one test (pair with `vi.unstubAllGlobals()`). */
export function installFakeIntersectionObserver() {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
}

/** Tell every observer on `element` where it is, as the browser would while the user scrolls. */
export function moveTo(element: Element, zone: Zone) {
  if (!FakeIntersectionObserver.instances.some((observer) => observer.observed.has(element))) {
    throw new Error("moveTo: no observer watches this element");
  }
  act(() => {
    for (const observer of FakeIntersectionObserver.instances) {
      if (observer.rootMargin === DRAW_MARGIN) observer.report(element, zone === "near");
      if (observer.rootMargin === RELEASE_MARGIN) observer.report(element, zone !== "far");
    }
  });
}
