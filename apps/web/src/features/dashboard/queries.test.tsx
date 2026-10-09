import { PROBLEM_TYPES } from "@kr/contracts";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/render";
import { useJobFacets } from "./queries";
import { syntheticFacets } from "./test-fixtures";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

function wrapper({ children }: { readonly children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe("useJobFacets", () => {
  it("asks for the counts of the chosen status filter", async () => {
    const asked: (string | null)[] = [];
    server.use(
      handlerFor("getJobFacets", ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("status"));
        return HttpResponse.json(syntheticFacets());
      }),
    );
    const { result } = renderHook(() => useJobFacets("complete"), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.statusCounts.all).toBe(7);
    });
    expect(asked).toEqual(["complete"]);
  });

  it("reports a failure as an error", async () => {
    server.use(mockProblem("getJobFacets", 500, PROBLEM_TYPES.internal));
    const { result } = renderHook(() => useJobFacets("all"), { wrapper });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
