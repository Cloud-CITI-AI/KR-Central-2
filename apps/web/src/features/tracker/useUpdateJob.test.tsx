import { PROBLEM_TYPES } from "@kr/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/api";
import { BannerProvider, useBanners } from "@/lib/banner/BannerProvider";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/render";
import { syntheticJob } from "./test-fixtures";
import { useJob } from "./useJob";
import { applyJobEdit, useUpdateJob } from "./useUpdateJob";

function setup(job = syntheticJob()) {
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
      return { update: useUpdateJob(job.id), banners: useBanners().banners };
    },
    { wrapper },
  );
  return { job, queryClient, ...hook };
}

describe("applyJobEdit", () => {
  const job = syntheticJob();

  it("shows a manual conformed date with the outcome date 90 days on, like the API (R10)", () => {
    const edited = applyJobEdit(job, { conformedDate: "2026-03-16" });
    expect(edited).toMatchObject({ conformedDate: "2026-03-16", outcomeDate: "2026-06-14" });
    expect(edited.conformedSource?.method).toBe("manual");
  });

  it("keeps an outcome date sent with the conformed date, also when the conformed date is cleared", () => {
    expect(applyJobEdit(job, { conformedDate: "2026-03-16", outcomeDate: "2026-07-01" }).outcomeDate).toBe(
      "2026-07-01",
    );
    const withDates = { ...job, conformedDate: "2026-03-16", outcomeDate: "2026-06-14" };
    expect(applyJobEdit(withDates, { conformedDate: null, outcomeDate: "2026-07-01" })).toMatchObject({
      conformedDate: null,
      outcomeDate: "2026-07-01",
    });
  });

  it("clears the outcome date with the conformed date, like the API (R10), so the countdown stops", () => {
    const withDates = { ...job, conformedDate: "2026-03-16", outcomeDate: "2026-07-01" };
    expect(applyJobEdit(withDates, { conformedDate: null })).toMatchObject({
      conformedDate: null,
      conformedSource: null,
      outcomeDate: null,
    });
  });

  it("applies plain fields and ignores the ones not sent", () => {
    expect(applyJobEdit(job, { address: "9 Example St", clientName: undefined })).toMatchObject({
      address: "9 Example St",
      clientName: job.clientName,
    });
  });
});

describe("useUpdateJob", () => {
  it("shows the edit at once, sends If-Match with the cached version and stores the answer", async () => {
    const { job, queryClient, result } = setup();
    const seen: { ifMatch: string | null; body: unknown }[] = [];
    server.use(
      handlerFor("updateJob", async ({ request }) => {
        seen.push({ ifMatch: request.headers.get("if-match"), body: await request.json() });
        return HttpResponse.json({ ...job, address: "9 Example St", version: 2 });
      }),
    );
    act(() => {
      result.current.update.mutate({ address: "9 Example St" });
    });
    await waitFor(() => {
      expect(queryClient.getQueryData<typeof job>(queryKeys.jobs.detail(job.id))?.address).toBe("9 Example St");
    });
    await waitFor(() => {
      expect(result.current.update.isSuccess).toBe(true);
    });
    expect(seen).toEqual([{ ifMatch: '"1"', body: { address: "9 Example St" } }]);
    expect(queryClient.getQueryData<typeof job>(queryKeys.jobs.detail(job.id))?.version).toBe(2);
  });

  it("on 412 reloads the job and shows the stale banner", async () => {
    const { job, result } = setup();
    server.use(
      mockProblem("updateJob", 412, PROBLEM_TYPES.preconditionFailed),
      mockApi("getJob", { ...job, version: 5 }),
    );
    await act(async () => {
      await expect(result.current.update.mutateAsync({ address: "9 Example St" })).rejects.toThrow();
    });
    await waitFor(() => {
      expect(result.current.banners.map((b) => b.id)).toEqual(["stale"]);
    });
  });

  it("on 412 keeps the value the person typed on the reloaded job, with the server's version", async () => {
    const { job, queryClient, result } = setup();
    server.use(
      mockProblem("updateJob", 412, PROBLEM_TYPES.preconditionFailed),
      mockApi("getJob", { ...job, address: "Changed by someone else", clientName: "Their client", version: 5 }),
    );
    await act(async () => {
      await expect(
        result.current.update.mutateAsync({ address: "9 Example St", approvalDate: "2026-09-01" }),
      ).rejects.toThrow();
    });
    await waitFor(() => {
      expect(result.current.banners.map((b) => b.id)).toEqual(["stale"]);
    });
    expect(queryClient.getQueryData<typeof job>(queryKeys.jobs.detail(job.id))).toMatchObject({
      address: "9 Example St",
      approvalDate: "2026-09-01",
      clientName: "Their client",
      version: 5,
    });
  });

  it("on another failure rolls back and shows the save-failed banner with the request id", async () => {
    const { job, queryClient, result } = setup();
    server.use(mockProblem("updateJob", 500, PROBLEM_TYPES.internal, { requestId: "req-1" }));
    await act(async () => {
      await expect(result.current.update.mutateAsync({ address: "9 Example St" })).rejects.toThrow();
    });
    expect(queryClient.getQueryData<typeof job>(queryKeys.jobs.detail(job.id))?.address).toBe(job.address);
    expect(result.current.banners[0]?.text).toContain("Request ID: req-1");
  });

  it("leaves a 409 to the caller: rolls back without a banner", async () => {
    const { result } = setup();
    server.use(mockProblem("updateJob", 409, PROBLEM_TYPES.conflict));
    await act(async () => {
      await expect(result.current.update.mutateAsync({ jobNumber: "S-0002" })).rejects.toMatchObject({ status: 409 });
    });
    expect(result.current.banners).toEqual([]);
  });

  it("fails when no job is loaded", async () => {
    const { queryClient, job, result } = setup();
    queryClient.removeQueries({ queryKey: queryKeys.jobs.detail(job.id) });
    await act(async () => {
      await expect(result.current.update.mutateAsync({ address: "x" })).rejects.toThrow("Nothing loaded");
    });
  });
});
