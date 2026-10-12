import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockApi, mockProblem, mockRateLimited } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { ArchiveJobDialog } from "./ArchiveJobDialog";
import { LAST_JOB_KEY } from "./lastJob";
import { syntheticJob } from "./test-fixtures";
import { renderTracker, router } from "./test-utils";

vi.mock("next/navigation", async () => (await import("./test-utils")).navigationMock);

function setup() {
  const job = syntheticJob({ role: "admin", fields: { jobNumber: "S-0001" } });
  const onClose = vi.fn();
  const view = renderTracker(<ArchiveJobDialog job={job} open onClose={onClose} />);
  view.queryClient.setQueryData(queryKeys.jobs.detail(job.id), { ...job, version: 3 });
  return { job, onClose, ...view };
}

describe("ArchiveJobDialog", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(router, "push").mockImplementation(() => undefined);
  });

  it("asks the §5.1 question with ARCHIVE and Cancel, Cancel having focus", async () => {
    const { onClose, container } = setup();
    expect(
      screen.getByText(
        "Archive S-0001? It disappears from the dashboard and job picker for everyone, and client/architect access stops. Files and history are kept.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("archives with If-Match, forgets the last job and opens the dashboard with ?archived=<job number>", async () => {
    const { job, queryClient } = setup();
    localStorage.setItem(LAST_JOB_KEY, job.id);
    const seen: (string | null)[] = [];
    server.use(
      handlerFor("deleteJob", ({ request }) => {
        seen.push(request.headers.get("if-match"));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "ARCHIVE" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/?archived=S-0001");
    });
    expect(seen).toEqual(['"3"']);
    expect(localStorage.getItem(LAST_JOB_KEY)).toBeNull();
    expect(queryClient.getQueryData(queryKeys.jobs.detail(job.id))).toBeUndefined();
  });

  it("on 412 closes, reloads the job and shows the stale banner", async () => {
    const { job, onClose } = setup();
    server.use(
      mockProblem("deleteJob", 412, PROBLEM_TYPES.preconditionFailed),
      mockApi("getJob", { ...job, version: 9 }),
    );
    await userEvent.click(screen.getByRole("button", { name: "ARCHIVE" }));
    expect(
      await screen.findByText("Someone else changed this — the latest version has been loaded."),
    ).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("on another failure closes and shows the save-failed banner with the request id", async () => {
    const { onClose } = setup();
    server.use(mockProblem("deleteJob", 500, PROBLEM_TYPES.internal, { requestId: "req-9" }));
    await userEvent.click(screen.getByRole("button", { name: "ARCHIVE" }));
    expect(await screen.findByText(/A change couldn't be saved.*Request ID: req-9/)).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("on a 429 closes and says to wait, with the request id", async () => {
    const { onClose } = setup();
    server.use(mockRateLimited("deleteJob"));
    await userEvent.click(screen.getByRole("button", { name: "ARCHIVE" }));
    expect(
      await screen.findByText("Too many changes – wait a moment and try again. (Request ID: req-429)"),
    ).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });
});
