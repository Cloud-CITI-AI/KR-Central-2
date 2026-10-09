import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Countdown } from "./Countdown";

/** 12:00 in Perth on Wed 10 Jun 2026. */
const NOW = new Date("2026-06-10T04:00:00Z");

const tiles = () => [...document.querySelectorAll("b")].map((b) => b.textContent);
const units = () => [...document.querySelectorAll("i")].map((i) => i.textContent);
const state = () => document.querySelector("[data-state]")?.getAttribute("data-state");

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows days, hours, minutes and seconds to the end of the outcome day in Perth, and the caption", () => {
    render(<Countdown outcomeDate="2026-06-14" />);
    expect(tiles()).toEqual(["4", "11", "59", "59"]);
    expect(units()).toEqual(["days", "hrs", "min", "sec"]);
    expect(screen.getByText("until outcome date – Sun, 14 Jun 2026")).toBeInTheDocument();
  });

  it("ticks every second from the injected clock", () => {
    render(<Countdown outcomeDate="2026-06-14" />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(tiles()).toEqual(["4", "11", "59", "58"]);
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(tiles()).toEqual(["4", "11", "58", "59"]);
    act(() => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(tiles()).toEqual(["4", "10", "58", "59"]);
  });

  it("says day, not days, for exactly one", () => {
    render(<Countdown outcomeDate="2026-06-11" />);
    expect(units()[0]).toBe("day");
  });

  it("is ok from 14 days, soon under 14 days", () => {
    const { rerender } = render(<Countdown outcomeDate="2026-07-14" />);
    expect(state()).toBe("ok");
    rerender(<Countdown outcomeDate="2026-06-23" />);
    expect(state()).toBe("soon");
    rerender(<Countdown outcomeDate="2026-06-24" />);
    expect(state()).toBe("ok");
  });

  it("turns to the past state with the passed caption and counts up", () => {
    render(<Countdown outcomeDate="2026-06-09" />);
    expect(state()).toBe("past");
    expect(screen.getByText("Outcome date passed – Tue, 9 Jun 2026")).toBeInTheDocument();
    expect(tiles()).toEqual(["0", "12", "00", "01"]);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(tiles()).toEqual(["0", "12", "00", "02"]);
  });

  it("stops ticking when it goes away", () => {
    const { unmount } = render(<Countdown outcomeDate="2026-06-14" />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
