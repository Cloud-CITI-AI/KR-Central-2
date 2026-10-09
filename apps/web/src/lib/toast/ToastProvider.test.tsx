import { act, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./ToastProvider";

afterEach(() => {
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("shows a toast and removes it after its duration", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast(), {
      wrapper: ({ children }) => <ToastProvider durationMs={1000}>{children}</ToastProvider>,
    });
    act(() => {
      result.current.toast("Saved");
      result.current.toast("3 files uploaded");
    });
    expect(result.current.toasts.map((t) => t.text)).toEqual(["Saved", "3 files uploaded"]);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.toasts).toEqual([]);
  });

  it("clears pending timers on unmount and fails loudly outside the provider", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useToast(), { wrapper: ToastProvider });
    act(() => {
      result.current.toast("Saved");
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    function Probe() {
      useToast();
      return null;
    }
    expect(() => render(<Probe />)).toThrow(/ToastProvider/);
  });
});
