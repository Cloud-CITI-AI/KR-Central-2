import { PROBLEM_TYPES } from "@kr/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { useJob } from "@/features/tracker";
import { queryKeys } from "@/lib/api";
import { BannerProvider, useBanners } from "@/lib/banner/BannerProvider";
import { mockApi, mockOffline, mockProblem, mockRateLimited } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/render";
import { checkpointOf, withCheckpoint } from "./test-utils";
import { useMarkPaid } from "./usePaid";
import { useRecordDecision } from "./useRecordDecision";
import { useUpdateCheckpoint } from "./useUpdateCheckpoint";

function setup(key = "i8_3") {
  const job = syntheticJob();
  const queryClient = createTestQueryClient();
  queryClient.setQueryDefaults(queryKeys.jobs.detail(job.id), { staleTime: Infinity });
  queryClient.setQueryData(queryKeys.jobs.detail(job.id), job);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BannerProvider>{children}</BannerProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    () => {
      useJob(job.id); // the observer that gives the reload its query function, as in the tracker
      return { write: useUpdateCheckpoint(job.id, key), banners: useBanners().banners };
    },
    {
      wrapper,
    },
  );
  const cached = () => queryClient.getQueryData<typeof job>(queryKeys.jobs.detail(job.id));
  return { job, key, queryClient, cached, ...hook };
}

describe("useCheckpointWrite on a 412", () => {
  it("keeps the KR note the person typed on the reloaded checkpoint, with the new version, and shows the stale banner", async () => {
    const { job, key, cached, result } = setup();
    server.use(
      mockProblem("updateCheckpoint", 412, PROBLEM_TYPES.preconditionFailed),
      mockApi(
        "getJob",
        withCheckpoint(job, key, { status: "completed", storedStatus: "completed", krNote: "theirs", version: 4 }),
      ),
    );
    await act(async () => {
      await expect(result.current.write.mutateAsync({ krNote: "typed by me" })).rejects.toThrow();
    });
    await waitFor(() => {
      expect(result.current.banners.map((b) => b.id)).toEqual(["stale"]);
    });
    expect(checkpointOf(cached()!, key)).toMatchObject({
      krNote: "typed by me",
      status: "completed",
      version: 4,
    });
  });

  it("puts a refused status back to the server's value: only typed text is kept", async () => {
    const { job, key, cached, result } = setup();
    server.use(
      mockProblem("updateCheckpoint", 412, PROBLEM_TYPES.preconditionFailed),
      mockApi("getJob", withCheckpoint(job, key, { status: "not_required", storedStatus: "not_required", version: 3 })),
    );
    await act(async () => {
      await expect(result.current.write.mutateAsync({ status: "completed" })).rejects.toThrow();
    });
    expect(checkpointOf(cached()!, key)).toMatchObject({ status: "not_required", krNote: "", version: 3 });
  });

  it("keeps the typed note even when the reload fails, and rolls it back on other errors", async () => {
    const { job, key, cached, result } = setup();
    server.use(
      mockProblem("updateCheckpoint", 412, PROBLEM_TYPES.preconditionFailed),
      mockProblem("getJob", 500, PROBLEM_TYPES.internal),
    );
    await act(async () => {
      await expect(result.current.write.mutateAsync({ krNote: "typed by me" })).rejects.toThrow();
    });
    expect(checkpointOf(cached()!, key)).toMatchObject({ krNote: "typed by me", version: 1 });
    server.use(mockProblem("updateCheckpoint", 500, PROBLEM_TYPES.internal));
    await act(async () => {
      await expect(result.current.write.mutateAsync({ krNote: "another" })).rejects.toThrow();
    });
    expect(checkpointOf(cached()!, key).krNote).toBe("typed by me");
    expect(job.checkpoints.length).toBeGreaterThan(0);
  });
});

describe("useCheckpointWrite on 429 and no connection (every checkpoint write, not only status and KR note)", () => {
  it("says to wait on a 429 (mark paid) and that the server can't be reached (decision)", async () => {
    const job = syntheticJob();
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(queryKeys.jobs.detail(job.id), { staleTime: Infinity });
    queryClient.setQueryData(queryKeys.jobs.detail(job.id), job);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <BannerProvider>{children}</BannerProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(
      () => ({
        paid: useMarkPaid(job.id, "i8_3"),
        decision: useRecordDecision(job.id, "i8_3"),
        banners: useBanners().banners,
      }),
      { wrapper },
    );
    server.use(mockRateLimited("markPaid"));
    await act(async () => {
      await expect(result.current.paid.mutateAsync(undefined)).rejects.toThrow();
    });
    await waitFor(() => {
      expect(result.current.banners.map((b) => b.text)).toEqual([
        "Too many changes – wait a moment and try again. (Request ID: req-429)",
      ]);
    });
    server.use(mockOffline("recordDecision"));
    await act(async () => {
      await expect(result.current.decision.mutateAsync({ value: "accepted", comment: "" })).rejects.toThrow();
    });
    await waitFor(() => {
      expect(result.current.banners.map((b) => b.text)).toEqual([
        "Can't reach the server – check your connection. What you see may be out of date, and changes can't be saved.",
      ]);
    });
  });
});
