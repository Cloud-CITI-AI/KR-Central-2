import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-09T04:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at the current time and moves on at every interval", () => {
    const { result } = renderHook(() => useNow(1000));
    expect(result.current.toISOString()).toBe("2026-10-09T04:00:00.000Z");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.toISOString()).toBe("2026-10-09T04:00:03.000Z");
  });

  it("stops ticking when unmounted", () => {
    const { unmount } = renderHook(() => useNow(1000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
