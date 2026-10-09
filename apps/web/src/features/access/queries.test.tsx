import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { syntheticJobCard } from "@/features/dashboard/test-fixtures";
import { handlerFor } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/render";
import { useJobChoices } from "./queries";

function wrapper({ children }: { readonly children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe("useJobChoices", () => {
  it("fetches every page of jobs in job-number order, 100 at a time", async () => {
    const first = syntheticJobCard({ jobNumber: "S-0001" });
    const second = syntheticJobCard({ jobNumber: "S-0002" });
    const asked: URLSearchParams[] = [];
    server.use(
      handlerFor("listJobs", ({ request }) => {
        const query = new URL(request.url).searchParams;
        asked.push(query);
        return HttpResponse.json(
          query.get("cursor") ? { items: [second], nextCursor: null } : { items: [first], nextCursor: "p2" },
        );
      }),
    );
    const { result } = renderHook(() => useJobChoices(), { wrapper });
    await waitFor(() => {
      expect(result.current.choices.map((job) => job.jobNumber)).toEqual(["S-0001", "S-0002"]);
    });
    expect(asked.map((q) => Object.fromEntries(q))).toEqual([
      { status: "all", sort: "job_number", limit: "100" },
      { status: "all", sort: "job_number", limit: "100", cursor: "p2" },
    ]);
  });
});
