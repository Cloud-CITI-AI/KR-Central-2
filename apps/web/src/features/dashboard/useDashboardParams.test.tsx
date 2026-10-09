import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getTestUrl, setTestUrl } from "./test-router";
import { useDashboardParams } from "./useDashboardParams";

vi.mock("next/navigation", async () => (await import("./test-router")).navigationMock);

describe("useDashboardParams", () => {
  it("reads the filters from the URL", () => {
    setTestUrl("/?status=complete&type=Freehold&q=lot");
    const { result } = renderHook(() => useDashboardParams());
    expect(result.current.params).toEqual({ status: "complete", type: "Freehold", q: "lot", archived: "" });
  });

  it("replaces the URL with the new filters and follows it", () => {
    setTestUrl("/?archived=S-0001");
    const { result } = renderHook(() => useDashboardParams());
    act(() => {
      result.current.update({ status: "all" });
    });
    expect(getTestUrl()).toBe("/?archived=S-0001&status=all");
    expect(result.current.params.status).toBe("all");
    act(() => {
      result.current.update({ status: "in_progress" });
    });
    expect(getTestUrl()).toBe("/?archived=S-0001");
  });
});
