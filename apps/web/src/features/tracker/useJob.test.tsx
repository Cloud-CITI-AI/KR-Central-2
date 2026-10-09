import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/api";
import { mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/render";
import { syntheticJob } from "./test-fixtures";
import { useJob } from "./useJob";

function setup() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useJob", () => {
  it("loads the job on queryKeys.jobs.detail so other features share it", async () => {
    const job = syntheticJob();
    server.use(mockApi("getJob", job));
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useJob(job.id), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.jobNumber).toBe(job.jobNumber);
    });
    expect(queryClient.getQueryData(queryKeys.jobs.detail(job.id))).toEqual(result.current.data);
  });
});
