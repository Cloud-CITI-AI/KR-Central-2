import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BannerRegion } from "@/components/ui/BannerRegion";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { Dashboard } from "./Dashboard";
import { setTestUrl } from "./test-router";
import { syntheticFacets, syntheticJobCard } from "./test-fixtures";

vi.mock("next/navigation", async () => (await import("./test-router")).navigationMock);

const OFFLINE = "Can't reach the server – check your connection.";
const renderDashboard = () =>
  renderWithProviders(
    <>
      <BannerRegion />
      <Dashboard />
    </>,
  );
/** The banners about the dashboard failing: every element that says so. */
const failureNotices = () => screen.queryAllByText(/couldn't be (loaded|refreshed)|Can't reach the server/);

beforeEach(() => {
  setTestUrl("/");
  // The jobbar and the access list ask for these too; the tests are about the dashboard's own queries.
  server.use(mockApi("getMe", syntheticMe()), mockApi("listAccessGrants", { items: [], nextCursor: null }));
});

describe("Dashboard load failures", () => {
  it("shows one banner, in a live region, with the request id when the jobs and the counts both fail", async () => {
    server.use(
      mockProblem("listJobs", 500, PROBLEM_TYPES.internal, { requestId: "req-jobs-1" }),
      mockProblem("getJobFacets", 500, PROBLEM_TYPES.internal, { requestId: "req-facets-1" }),
    );
    const { container } = renderDashboard();
    const notice = await screen.findByText(/The dashboard couldn't be loaded/);
    expect(failureNotices()).toHaveLength(1);
    expect(notice).toHaveTextContent("Reload the page and try again. (Request ID: req-jobs-1)");
    expect(notice.closest('[role="status"]')).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  it("says the server can't be reached, without a request id, when both requests never arrive", async () => {
    server.use(
      handlerFor("listJobs", () => HttpResponse.error()),
      handlerFor("getJobFacets", () => HttpResponse.error()),
    );
    renderDashboard();
    const notice = await screen.findByText(new RegExp(OFFLINE));
    expect(failureNotices()).toHaveLength(1);
    expect(notice).not.toHaveTextContent(/Request ID/);
    expect(notice).not.toHaveTextContent(/couldn't be loaded/);
    expect(notice.closest('[role="status"]')).not.toBeNull();
  });

  it("keeps the cached cards, warns they may be out of date and shows one banner when a refresh fails", async () => {
    server.use(
      mockApi("listJobs", { items: [syntheticJobCard({ jobNumber: "S-0042" })], nextCursor: null }),
      mockApi("getJobFacets", syntheticFacets()),
    );
    const { queryClient } = renderDashboard();
    expect(await screen.findByRole("link", { name: "Open job S-0042" })).toBeInTheDocument();
    expect(failureNotices()).toHaveLength(0);

    server.use(
      handlerFor("listJobs", () => HttpResponse.error()),
      handlerFor("getJobFacets", () => HttpResponse.error()),
    );
    await queryClient.refetchQueries();
    const notice = await screen.findByText(new RegExp(OFFLINE));
    expect(notice).toHaveTextContent("What you see may be out of date.");
    expect(failureNotices()).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Open job S-0042" })).toBeInTheDocument();
  });

  it("says a refresh failed with the request id (not 'couldn't be loaded') when there is cached data and the API answered", async () => {
    server.use(
      mockApi("listJobs", { items: [syntheticJobCard({ jobNumber: "S-0042" })], nextCursor: null }),
      mockApi("getJobFacets", syntheticFacets()),
    );
    const { queryClient } = renderDashboard();
    await screen.findByRole("link", { name: "Open job S-0042" });
    server.use(
      mockProblem("listJobs", 503, PROBLEM_TYPES.internal, { requestId: "req-late-1" }),
      mockProblem("getJobFacets", 503, PROBLEM_TYPES.internal, { requestId: "req-late-2" }),
    );
    await queryClient.refetchQueries();
    const notice = await screen.findByText(/couldn't be refreshed/);
    expect(notice).toHaveTextContent("what you see may be out of date");
    expect(notice).toHaveTextContent("(Request ID: req-late-1)");
    expect(failureNotices()).toHaveLength(1);
    expect(screen.queryByText(/couldn't be loaded/)).not.toBeInTheDocument();
  });

  it("reports a failure of the counts alone once, and removes the banner when the next refresh works", async () => {
    server.use(
      mockApi("listJobs", { items: [syntheticJobCard({ jobNumber: "S-0042" })], nextCursor: null }),
      mockProblem("getJobFacets", 500, PROBLEM_TYPES.internal, { requestId: "req-facets-2" }),
    );
    const { queryClient } = renderDashboard();
    await screen.findByText(/Request ID: req-facets-2/);
    expect(failureNotices()).toHaveLength(1);
    server.use(mockApi("getJobFacets", syntheticFacets()));
    await queryClient.refetchQueries();
    await waitFor(() => {
      expect(failureNotices()).toHaveLength(0);
    });
    expect(within(document.body).queryByText(/Request ID/)).not.toBeInTheDocument();
  });
});
