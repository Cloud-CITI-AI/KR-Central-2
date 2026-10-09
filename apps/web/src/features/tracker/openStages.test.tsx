import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_STAGES_KEY, useOpenStages } from "./openStages";

const stored = () => JSON.parse(localStorage.getItem(OPEN_STAGES_KEY) ?? "null") as unknown;

describe("useOpenStages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts closed and remembers toggles in localStorage kr-wf-open", () => {
    const { result } = renderHook(() => useOpenStages());
    expect(result.current.isOpen("survey")).toBe(false);
    act(() => {
      result.current.toggle("survey");
    });
    expect(result.current.isOpen("survey")).toBe(true);
    expect(stored()).toEqual(["survey"]);
    act(() => {
      result.current.toggle("survey");
    });
    expect(stored()).toEqual([]);
  });

  it("restores what was remembered and drops unknown keys, bad JSON and non-arrays", () => {
    localStorage.setItem(OPEN_STAGES_KEY, JSON.stringify(["titles", "nonsense", 3]));
    expect(renderHook(() => useOpenStages()).result.current.isOpen("titles")).toBe(true);
    for (const bad of ["{not json", '{"a":1}']) {
      localStorage.setItem(OPEN_STAGES_KEY, bad);
      expect(renderHook(() => useOpenStages()).result.current.isOpen("titles")).toBe(false);
    }
  });

  it("opens one stage without closing the others and ignores opening an open one", () => {
    const { result } = renderHook(() => useOpenStages());
    act(() => {
      result.current.open("survey");
    });
    act(() => {
      result.current.open("titles");
    });
    act(() => {
      result.current.open("titles");
    });
    expect(stored()).toEqual(["survey", "titles"]);
  });

  it("expands and collapses all", () => {
    const { result } = renderHook(() => useOpenStages());
    act(() => {
      result.current.expandAll();
    });
    expect(stored()).toHaveLength(10);
    act(() => {
      result.current.collapseAll();
    });
    expect(stored()).toEqual([]);
  });

  it("still works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useOpenStages());
    act(() => {
      result.current.toggle("landgate");
    });
    expect(result.current.isOpen("landgate")).toBe(true);
  });

  it("Save as PDF opens every stage for the print dialog and restores them afterwards", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const { result } = renderHook(() => useOpenStages());
    act(() => {
      result.current.open("survey");
    });
    act(() => {
      result.current.saveAsPdf();
    });
    expect(print).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen("wapc")).toBe(true);
    expect(stored()).toEqual(["survey"]);
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(result.current.isOpen("wapc")).toBe(false);
    expect(result.current.isOpen("survey")).toBe(true);
  });
});
