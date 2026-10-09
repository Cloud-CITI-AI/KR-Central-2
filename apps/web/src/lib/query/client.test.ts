import { focusManager, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProblem } from "@/lib/api/problem";
import { createQueryClient, shouldRetry } from "./client";

const problem = (status: number) => new ApiProblem({ type: "about:blank", title: "x", status, requestId: "r" });

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("shouldRetry", () => {
  it("does not retry 4xx problems, retries 5xx, network failures and unknown errors twice", () => {
    expect(shouldRetry(0, problem(404))).toBe(false);
    expect(shouldRetry(0, problem(412))).toBe(false);
    expect(shouldRetry(0, problem(503))).toBe(true);
    expect(shouldRetry(0, problem(0))).toBe(true);
    expect(shouldRetry(1, new Error("boom"))).toBe(true);
    expect(shouldRetry(2, problem(503))).toBe(false);
  });
});

describe("createQueryClient", () => {
  it("refetches every 15 s while the tab is visible, not in the background, and on focus", async () => {
    vi.useFakeTimers();
    const client = createQueryClient();
    client.mount(); // what <QueryClientProvider> does: wires focus and online events
    const queryFn = vi.fn(() => Promise.resolve("data"));
    const unsubscribe = new QueryObserver(client, { queryKey: ["probe"], queryFn }).subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(1);
    expect(queryFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(queryFn).toHaveBeenCalledTimes(2);
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(queryFn).toHaveBeenCalledTimes(2);
    focusManager.setFocused(true); // back to the tab: stale data refetches at once
    await vi.advanceTimersByTimeAsync(1);
    expect(queryFn).toHaveBeenCalledTimes(3);
    unsubscribe();
    client.unmount();
  });

  it("never retries mutations", () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });
});
