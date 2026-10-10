import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { HttpResponse } from "msw";
import { TrackerPage } from "./TrackerPage";
import { LAST_JOB_KEY } from "./lastJob";
import { jobPage, syntheticJob } from "./test-fixtures";
import { NOT_FOUND, renderTracker, WHOLE_TRACKER_TIMEOUT_MS } from "./test-utils";

vi.mock("next/navigation", async () => (await import("./test-utils")).navigationMock);

class Boundary extends Component<{ readonly children: ReactNode }, { readonly error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  override render() {
    return this.state.error ? <p>caught {this.state.error}</p> : this.props.children;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  localStorage.clear();
});

describe("TrackerPage", { timeout: WHOLE_TRACKER_TIMEOUT_MS }, () => {
  it("shows a status while loading, then the jobbar, and remembers the job for the dashboard's back link", async () => {
    const job = syntheticJob();
    server.use(mockApi("getJob", job), mockApi("listJobs", jobPage([])));
    const { container } = renderTracker(<TrackerPage jobId={job.id} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading job…");
    expect(await screen.findByRole("combobox", { name: "Job" })).toBeInTheDocument();
    expect(localStorage.getItem(LAST_JOB_KEY)).toBe(job.id);
    await expectNoAxeViolations(container);
  });

  it("shows the summary panels and the ten stages under the jobbar", async () => {
    const job = syntheticJob();
    server.use(mockApi("getJob", job), mockApi("listJobs", jobPage([])));
    renderTracker(<TrackerPage jobId={job.id} />);
    await screen.findByRole("combobox", { name: "Job" });
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(10);
    expect(document.getElementById("water-corporation")).not.toBeNull();
  });

  it("still works when storage is blocked", async () => {
    const job = syntheticJob();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    server.use(mockApi("getJob", job), mockApi("listJobs", jobPage([])));
    renderTracker(<TrackerPage jobId={job.id} />);
    expect(await screen.findByRole("combobox", { name: "Job" })).toBeInTheDocument();
  });

  it("renders the not-found page when the API answers 404 (also a job the person may not see)", async () => {
    server.use(mockProblem("getJob", 404, PROBLEM_TYPES.notFound));
    renderTracker(
      <Boundary>
        <TrackerPage jobId={syntheticJob().id} />
      </Boundary>,
    );
    expect(await screen.findByText(`caught ${NOT_FOUND}`)).toBeInTheDocument();
  });

  it("shows the view-only banner to architects and none to staff (§5.1)", async () => {
    const architect = syntheticJob({ role: "external", grantRole: "architect" });
    server.use(mockApi("getJob", architect), mockApi("listJobs", jobPage([])));
    const view = renderTracker(<TrackerPage jobId={architect.id} />);
    expect(
      await screen.findByText("You have view-only access to this tracker, so changes can't be saved."),
    ).toBeInTheDocument();
    view.unmount();
    const staff = syntheticJob();
    server.use(mockApi("getJob", staff));
    renderTracker(<TrackerPage jobId={staff.id} />);
    await screen.findByRole("combobox", { name: "Job" });
    expect(screen.queryByText(/view-only/)).toBeNull();
  });

  it("does not call a client with decision and paid rights view-only", async () => {
    const client = syntheticJob({ role: "external", grantRole: "client" });
    server.use(mockApi("getJob", client), mockApi("listJobs", jobPage([])));
    renderTracker(<TrackerPage jobId={client.id} />);
    await screen.findByRole("combobox", { name: "Job" });
    expect(screen.queryByText(/view-only/)).toBeNull();
  });

  it("shows a banner with the request id when the job cannot be loaded", async () => {
    server.use(mockProblem("getJob", 500, PROBLEM_TYPES.internal, { requestId: "req-abc" }));
    renderTracker(<TrackerPage jobId={syntheticJob().id} />);
    expect(
      await screen.findByText("This job couldn't be loaded. Reload the page and try again. (Request ID: req-abc)"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the connectivity banner when the server cannot be reached", async () => {
    server.use(handlerFor("getJob", () => HttpResponse.error()));
    renderTracker(<TrackerPage jobId={syntheticJob().id} />);
    expect(await screen.findByText(/Can't reach the server/)).toBeInTheDocument();
  });

  it("clears the load banner once a refresh succeeds", async () => {
    const job = syntheticJob();
    server.use(mockProblem("getJob", 500, PROBLEM_TYPES.internal));
    const { queryClient } = renderTracker(<TrackerPage jobId={job.id} />);
    await screen.findByText(/couldn't be loaded/);
    server.use(mockApi("getJob", job), mockApi("listJobs", jobPage([])));
    await queryClient.refetchQueries();
    await waitFor(() => {
      expect(screen.queryByText(/couldn't be loaded/)).toBeNull();
    });
  });

  it("opens the stage named by ?stage= once the job has loaded", async () => {
    const job = syntheticJob();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    server.use(mockApi("getJob", job), mockApi("listJobs", jobPage([])));
    renderTracker(<TrackerPage jobId={job.id} initialStage="landgate" />);
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
    expect(document.getElementById("landgate")?.querySelector("button")).toHaveAttribute("aria-expanded", "true");
  });
});
