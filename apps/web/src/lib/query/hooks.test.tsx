import { PROBLEM_TYPES } from "@kr/contracts";
import { useQuery } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { ApiProblem } from "@/lib/api/problem";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES } from "@/lib/messages";
import { handlerFor, mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { pollDelay, useOperation, useOptimisticVersionedMutation } from "./hooks";

interface Thing {
  readonly version: number;
  readonly name: string;
}
const KEY = ["thing"] as const;

function Harness({
  mutationFn,
  load,
}: {
  mutationFn: (name: string, ifMatch: number) => Promise<unknown>;
  load: () => Thing;
}) {
  const { data } = useQuery({ queryKey: KEY, queryFn: () => Promise.resolve(load()) });
  const mutation = useOptimisticVersionedMutation<Thing, string>({
    queryKey: KEY,
    getVersion: (current) => current.version,
    mutationFn,
    optimistic: (current, name) => ({ ...current, name }),
  });
  const { banners } = useBanners();
  return (
    <>
      <p>{data ? `${data.name} v${data.version}` : "loading"}</p>
      <button
        onClick={() => {
          mutation.mutate("Mine");
        }}
      >
        Save
      </button>
      <ul>
        {banners.map((b) => (
          <li key={b.id}>{b.text}</li>
        ))}
      </ul>
    </>
  );
}

describe("useOptimisticVersionedMutation", () => {
  it("applies the change at once, sends the cached version as If-Match and refetches after success", async () => {
    let server_ = { version: 3, name: "Theirs" };
    const mutationFn = vi.fn((name: string) => {
      server_ = { version: 4, name };
      return Promise.resolve({});
    });
    renderWithProviders(<Harness mutationFn={mutationFn} load={() => server_} />);
    await screen.findByText("Theirs v3");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutationFn).toHaveBeenCalledWith("Mine", 3);
    expect(await screen.findByText("Mine v4")).toBeInTheDocument();
  });

  it("on 412 rolls back, reloads the latest version and shows exactly the §5.1 stale banner", async () => {
    const server_ = { version: 5, name: "Latest from someone else" };
    const stale = new ApiProblem({
      type: PROBLEM_TYPES.preconditionFailed,
      title: "Stale",
      status: 412,
      requestId: "r1",
    });
    renderWithProviders(<Harness mutationFn={() => Promise.reject(stale)} load={() => server_} />);
    await screen.findByText("Latest from someone else v5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Someone else changed this — the latest version has been loaded."),
    ).toBeInTheDocument();
    expect(MESSAGES.stale).toBe("Someone else changed this — the latest version has been loaded.");
    expect(screen.getByText("Latest from someone else v5")).toBeInTheDocument();
  });

  it("on any other failure rolls back and shows the save-failed banner with the request id", async () => {
    const failure = new ApiProblem({ type: PROBLEM_TYPES.internal, title: "Boom", status: 500, requestId: "req-500" });
    renderWithProviders(
      <Harness mutationFn={() => Promise.reject(failure)} load={() => ({ version: 1, name: "Original" })} />,
    );
    await screen.findByText("Original v1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("A change couldn't be saved. Reload the page and try again. (Request ID: req-500)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Original v1")).toBeInTheDocument();
  });
});

describe("useOperation", () => {
  const JOB_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const op = (status: string) => ({
    id: JOB_ID,
    jobId: JOB_ID,
    type: "conformance.read",
    status,
    createdAt: "2026-09-28T03:50:56.543Z",
    completedAt: null,
    result: null,
    error: null,
  });

  it("polls until the operation finishes, then stops", async () => {
    const statuses = ["queued", "running", "succeeded"];
    let calls = 0;
    server.use(handlerFor("getOperation", () => HttpResponse.json(op(statuses[Math.min(calls++, 2)] ?? "succeeded"))));
    function Probe() {
      return <p>{useOperation(JOB_ID).data?.status ?? "none"}</p>;
    }
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByText("succeeded")).toBeInTheDocument(), { timeout: 4000 });
    const settled = calls;
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(settled);
  });

  it("makes its first re-poll after 1 s and the second after 1.5 s", async () => {
    const times: number[] = [];
    server.use(
      handlerFor("getOperation", () => {
        times.push(performance.now());
        return HttpResponse.json(op(times.length < 3 ? "running" : "succeeded"));
      }),
    );
    function Probe() {
      return <p>{useOperation(JOB_ID).data?.status ?? "none"}</p>;
    }
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByText("succeeded")).toBeInTheDocument(), { timeout: 5000 });
    const [first = 0, second = 0, third = 0] = times;
    expect(second - first).toBeGreaterThanOrEqual(950);
    expect(second - first).toBeLessThan(1400);
    expect(third - second).toBeGreaterThanOrEqual(1450);
    expect(third - second).toBeLessThan(2000);
  }, 10_000);

  it("does not call the API without an id", () => {
    server.use(mockApi("getOperation", op("queued")));
    function Probe() {
      return <p>{useOperation(null).fetchStatus}</p>;
    }
    renderWithProviders(<Probe />);
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("backs off from 1 s to a 5 s ceiling, counting re-polls from zero", () => {
    expect([0, 1, 2, 3, 4, 10].map(pollDelay)).toEqual([1000, 1500, 2250, 3375, 5000, 5000]);
  });
});
