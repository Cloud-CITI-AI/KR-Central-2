import { PROBLEM_TYPES } from "@kr/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useJob } from "@/features/tracker";
import { queryKeys } from "@/lib/api";
import { BannerProvider, useBanners } from "@/lib/banner/BannerProvider";
import { mockApi, mockOffline, mockProblem, mockRateLimited } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/render";
import { conditionAt, syntheticConditionJob, withCondition } from "./test-fixtures";
import { useUpdateCondition } from "./useUpdateCondition";

function setup() {
  const job = syntheticConditionJob({ agencies: ["Western Power"] });
  const condition = conditionAt(job, 0);
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
      return { write: useUpdateCondition(job.id, condition.id), banners: useBanners().banners };
    },
    {
      wrapper,
    },
  );
  const cached = () => conditionAt(queryClient.getQueryData<typeof job>(queryKeys.jobs.detail(job.id))!, 0);
  return { job, condition, queryClient, cached, ...hook };
}

describe("useUpdateCondition on a 412", () => {
  it("keeps the client comment the person typed on the reloaded condition, with the new version, and shows the stale banner", async () => {
    const { job, condition, cached, result } = setup();
    server.use(
      mockProblem("updateCondition", 412, PROBLEM_TYPES.preconditionFailed),
      mockApi("getJob", withCondition(job, condition.id, { krComment: "KR: power design lodged", version: 3 })),
    );
    await act(async () => {
      await expect(result.current.write.mutateAsync({ clientComment: "Client: thanks, will pay" })).rejects.toThrow();
    });
    await waitFor(() => {
      expect(result.current.banners.map((b) => b.id)).toEqual(["stale"]);
    });
    expect(cached()).toMatchObject({
      clientComment: "Client: thanks, will pay",
      krComment: "KR: power design lodged",
      version: 3,
    });
  });

  it("keeps a KR comment the same way, and puts a refused tick back to the server's value", async () => {
    const { job, condition, cached, result } = setup();
    server.use(
      mockProblem("updateCondition", 412, PROBLEM_TYPES.preconditionFailed),
      mockApi("getJob", withCondition(job, condition.id, { isCleared: true, version: 2 })),
    );
    await act(async () => {
      await expect(
        result.current.write.mutateAsync({ krComment: "Booked for May", isCleared: false }),
      ).rejects.toThrow();
    });
    expect(cached()).toMatchObject({ krComment: "Booked for May", isCleared: true, version: 2 });
  });

  it("keeps nothing of a tick or an agency change: the reloaded condition shows the server's values", async () => {
    const { job, condition, cached, result } = setup();
    server.use(
      mockProblem("updateCondition", 412, PROBLEM_TYPES.preconditionFailed),
      mockApi("getJob", withCondition(job, condition.id, { isCleared: true, agency: "Water Corporation", version: 2 })),
    );
    await act(async () => {
      await expect(result.current.write.mutateAsync({ agency: "WAPC" })).rejects.toThrow();
    });
    expect(cached()).toMatchObject({ agency: "Water Corporation", clientComment: "", version: 2 });
  });
});

describe("useUpdateCondition on 429 and no connection", () => {
  it("says to wait (with the request id) on a 429 and that the server can't be reached when the request never arrives", async () => {
    const { cached, condition, result } = setup();
    server.use(mockRateLimited("updateCondition"));
    await act(async () => {
      await expect(result.current.write.mutateAsync({ isCleared: true })).rejects.toThrow();
    });
    await waitFor(() => {
      expect(result.current.banners.map((b) => b.text)).toEqual([
        "Too many changes – wait a moment and try again. (Request ID: req-429)",
      ]);
    });
    server.use(mockOffline("updateCondition"));
    await act(async () => {
      await expect(result.current.write.mutateAsync({ isCleared: true })).rejects.toThrow();
    });
    await waitFor(() => {
      expect(result.current.banners.map((b) => b.text)).toEqual([
        "Can't reach the server – check your connection. What you see may be out of date, and changes can't be saved.",
      ]);
    });
    expect(cached().isCleared).toBe(condition.isCleared);
  });
});
