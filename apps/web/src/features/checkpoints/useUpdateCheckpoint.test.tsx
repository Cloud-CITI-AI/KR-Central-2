import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { queryKeys } from "@/lib/api";
import { MESSAGES } from "@/lib/messages";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { checkpointOf, renderCard, withCheckpoint } from "./test-utils";

describe("useUpdateCheckpoint (through the card controls)", () => {
  it("shows a status change at once, sends If-Match with the checkpoint version and keeps the server's answer", async () => {
    const job = syntheticJob();
    const seen: { ifMatch: string | null; body: unknown }[] = [];
    const { served } = renderCard(job, "i4_0");
    server.use(
      handlerFor("updateCheckpoint", async ({ request }) => {
        seen.push({ ifMatch: request.headers.get("if-match"), body: await request.json() });
        const answer = {
          ...checkpointOf(job, "i4_0"),
          status: "completed",
          storedStatus: "completed",
          version: 2,
        } as const;
        served.job = withCheckpoint(job, "i4_0", answer);
        return HttpResponse.json(answer);
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByRole("button", { name: "Completed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Not completed" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => {
      expect(seen).toEqual([{ ifMatch: '"1"', body: { status: "completed" } }]);
    });
    await waitFor(() => {
      expect(screen.getByRole("group", { name: /^4\.0 / })).toHaveAttribute("data-s", "completed");
    });
  });

  it("moves the progress counts and the stage bar with the status before the server answers", async () => {
    const job = syntheticJob();
    const { queryClient } = renderCard(job, "i4_0");
    server.use(handlerFor("updateCheckpoint", () => new Promise<Response>(() => undefined)));
    await userEvent.click(screen.getByRole("button", { name: "Completed" }));
    const cached = queryClient.getQueryData<typeof job>(queryKeys.jobs.detail(job.id));
    expect(cached?.summary.progress).toMatchObject({ completed: 1, notCompleted: 45, percent: 2 });
    expect(cached?.summary.stages.find((s) => s.stage === "wapc-approval")).toMatchObject({
      completed: 1,
      notCompleted: 5,
      label: "5 to do",
    });
    expect(cached?.checkpoints.find((c) => c.key === "i4_0")).toMatchObject({ status: "completed", version: 1 });
  });

  it("rolls back on 412, reloads the job and shows the stale banner", async () => {
    const job = syntheticJob();
    const { served } = renderCard(job, "i4_0");
    const reloaded = withCheckpoint(job, "i4_0", { status: "not_required", storedStatus: "not_required", version: 3 });
    server.use(mockProblem("updateCheckpoint", 412, PROBLEM_TYPES.preconditionFailed));
    served.job = reloaded;
    await userEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(await screen.findByText(MESSAGES.stale)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Not required" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("rolls back and shows the save-failed banner with the request id on other failures", async () => {
    renderCard(syntheticJob(), "i4_0");
    server.use(mockProblem("updateCheckpoint", 500));
    await userEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(await screen.findByText(/A change couldn't be saved/)).toHaveTextContent("Request ID: req-test-0001");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Not completed" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("says the server can't be reached (no request id, one banner) when the request never arrives, and rolls back", async () => {
    renderCard(syntheticJob(), "i4_0");
    server.use(handlerFor("updateCheckpoint", () => HttpResponse.error()));
    await userEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(await screen.findByText(MESSAGES.offline)).toBeInTheDocument();
    expect(screen.queryByText(/A change couldn't be saved/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Request ID/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Not completed" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("asks to wait when the API answers 429 with Retry-After, with the request id, and rolls back", async () => {
    renderCard(syntheticJob(), "i4_0");
    server.use(
      handlerFor("updateCheckpoint", () =>
        HttpResponse.json(
          { type: PROBLEM_TYPES.rateLimited, title: "Too many requests", status: 429, requestId: "req-rl-1" },
          { status: 429, headers: { "content-type": "application/problem+json", "retry-after": "30" } },
        ),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(await screen.findByText(/Too many changes – wait a moment and try again\./)).toHaveTextContent(
      "(Request ID: req-rl-1)",
    );
    expect(screen.queryByText(/Reload the page/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Not completed" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("sends the second of two quick edits with the version the first one produced", async () => {
    const job = syntheticJob();
    const { served } = renderCard(job, "i4_0");
    const versions: (string | null)[] = [];
    server.use(
      handlerFor("updateCheckpoint", ({ request }) => {
        versions.push(request.headers.get("if-match"));
        const answer = { ...checkpointOf(job, "i4_0"), version: versions.length + 1 };
        served.job = withCheckpoint(job, "i4_0", answer);
        return HttpResponse.json(answer);
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Completed" }));
    await userEvent.selectOptions(screen.getByRole("combobox"), "Client");
    await waitFor(() => {
      expect(versions).toEqual(['"1"', '"2"']);
    });
  });
});
