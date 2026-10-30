import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeIntersectionObserver, installFakeIntersectionObserver, moveTo } from "./test-intersection";
import { DRAW_MARGIN, RELEASE_MARGIN, useNearViewport } from "./useNearViewport";
import { useRef } from "react";

function Probe() {
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const near = useNearViewport(box, scroller);
  return (
    <div ref={scroller} data-testid="scroller">
      <div ref={box} data-testid="box">
        {near ? "near" : "far"}
      </div>
    </div>
  );
}

describe("useNearViewport", () => {
  beforeEach(installFakeIntersectionObserver);
  afterEach(vi.unstubAllGlobals);

  it("is false until the element nears the scroller's visible part", () => {
    render(<Probe />);
    expect(screen.getByTestId("box")).toHaveTextContent("far");
    moveTo(screen.getByTestId("box"), "near");
    expect(screen.getByTestId("box")).toHaveTextContent("near");
  });

  it("holds between the draw margin and the wider release margin, and lets go beyond it", () => {
    render(<Probe />);
    const box = screen.getByTestId("box");
    moveTo(box, "near");
    moveTo(box, "between");
    expect(box).toHaveTextContent("near");
    moveTo(box, "far");
    expect(box).toHaveTextContent("far");
    // coming back only to the band between the margins is not near enough to draw again
    moveTo(box, "between");
    expect(box).toHaveTextContent("far");
    moveTo(box, "near");
    expect(box).toHaveTextContent("near");
  });

  it("observes with the scrolling column as root and the two margins, and disconnects on unmount", () => {
    const { unmount } = render(<Probe />);
    const observers = FakeIntersectionObserver.instances;
    expect(observers.map((observer) => observer.rootMargin).sort()).toEqual([DRAW_MARGIN, RELEASE_MARGIN].sort());
    for (const observer of observers) expect(observer.root).toBe(screen.getByTestId("scroller"));
    unmount();
    for (const observer of observers) expect(observer.disconnected).toBe(true);
  });

  it("does not throw when IntersectionObserver goes away between render and effect", () => {
    // test teardown removes stubbed globals before cleanup() unmounts, so a page still mounting saw the API and then lost it
    function RemoveApi() {
      vi.stubGlobal("IntersectionObserver", undefined);
      return null;
    }
    expect(() =>
      render(
        <>
          <Probe />
          <RemoveApi />
        </>,
      ),
    ).not.toThrow();
  });

  it("is always true when the browser has no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Probe />);
    expect(screen.getByTestId("box")).toHaveTextContent("near");
  });
});
