import { STAGES } from "@kr/workflow";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { jobPage, syntheticJob } from "./test-fixtures";
import { renderTracker } from "./test-utils";
import { TrackerBody } from "./TrackerBody";
import type { StageKey } from "@kr/workflow";

vi.mock("next/navigation", async () => (await import("./test-utils")).navigationMock);

const scrollIntoView = vi.fn();
const reducedMotion = (matches: boolean) => {
  vi.stubGlobal("matchMedia", () => ({ matches }));
};
const bar = (stage: string) => {
  const button = document.getElementById(stage)?.querySelector("button");
  if (!button) throw new Error(stage);
  return button;
};
const scrolledIds = () => scrollIntoView.mock.contexts.map((element) => (element as HTMLElement).id);

function show(initialStage?: StageKey) {
  server.use(mockApi("listJobs", jobPage([])));
  return renderTracker(
    <>
      <a href="#western-power">Go to Western Power ↓</a>
      <a href="#elsewhere">Elsewhere</a>
      <TrackerBody job={syntheticJob()} initialStage={initialStage} />
    </>,
  );
}

describe("deep links", () => {
  beforeEach(() => {
    localStorage.clear();
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
    reducedMotion(false);
  });
  afterEach(async () => {
    window.location.hash = "";
    // jsdom delivers hashchange asynchronously: let this test's events end while the stubs are still in place
    await new Promise((resolve) => setTimeout(resolve, 20));
    vi.unstubAllGlobals();
  });

  it("?stage= opens that stage and scrolls to it", () => {
    show("survey");
    expect(bar("survey")).toHaveAttribute("aria-expanded", "true");
    expect(bar("landgate")).toHaveAttribute("aria-expanded", "false");
    expect(scrolledIds()).toEqual(["survey"]);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("#checkpoint-<key> opens the stage the card is in and scrolls to the card", () => {
    const stage = STAGES.find((s) => s.checkpoints.some((c) => c.key === "i13_2"));
    window.location.hash = "#checkpoint-i13_2";
    show();
    expect(bar(stage?.key ?? "")).toHaveAttribute("aria-expanded", "true");
    expect(scrolledIds()).toEqual(["checkpoint-i13_2"]);
  });

  it("follows a hash change after arrival", async () => {
    show();
    expect(scrollIntoView).not.toHaveBeenCalled();
    window.location.hash = "#checkpoint-i4_2";
    await waitFor(() => {
      expect(bar("wapc-approval")).toHaveAttribute("aria-expanded", "true");
    });
    expect(scrolledIds()).toEqual(["checkpoint-i4_2"]);
  });

  it("ignores a hash that is not a stage or a card", () => {
    window.location.hash = "#checkpoint-nope";
    show();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });

  it("opens and scrolls to a stage from a link like 'Go to Western Power', instead of following it", async () => {
    show();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole("link", { name: "Go to Western Power ↓" }).dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(bar("western-power")).toHaveAttribute("aria-expanded", "true");
    });
    expect(scrolledIds()).toEqual(["western-power"]);
  });

  it("scrolls again when the same link is used a second time", async () => {
    show();
    await userEvent.click(screen.getByRole("link", { name: "Go to Western Power ↓" }));
    await userEvent.click(screen.getByRole("link", { name: "Go to Western Power ↓" }));
    expect(scrolledIds()).toEqual(["western-power", "western-power"]);
  });

  it("does not smooth-scroll when the person prefers reduced motion", () => {
    reducedMotion(true);
    show("titles");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("leaves other links and modified clicks to the browser", () => {
    show();
    const other = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole("link", { name: "Elsewhere" }).dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    const link = screen.getByRole("link", { name: "Go to Western Power ↓" });
    fireEvent.click(link, { ctrlKey: true });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
