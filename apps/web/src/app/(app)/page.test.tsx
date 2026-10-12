import { PROBLEM_TYPES } from "@kr/contracts";
import { configure, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getTestUrl, setTestUrl } from "@/features/dashboard/test-router";
import { preloadDashboard, syntheticFacets } from "@/features/dashboard/test-fixtures";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import DashboardPage, { metadata } from "./page";

vi.mock("next/navigation", async () => (await import("@/features/dashboard/test-router")).navigationMock);

/** The cards grid, the job picker and the access list all start empty. */
const emptyLists = () => [
  mockApi("listJobs", { items: [], nextCursor: null }),
  mockApi("listAccessGrants", { items: [], nextCursor: null }),
];

beforeAll(preloadDashboard, 20_000);
configure({ asyncUtilTimeout: 5000 });

describe("DashboardPage", () => {
  it("is titled Dashboard", () => {
    expect(metadata.title).toBe("Dashboard");
  });

  it("renders the dashboard header with counts from the facets and leaves <main> and the h1 to the layout", async () => {
    setTestUrl("/");
    server.use(mockApi("getJobFacets", syntheticFacets()), ...emptyLists());
    const { container } = renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole("button", { name: "In progress (5)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Subdivision dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Summary" })).toHaveTextContent("2 Waiting on client");
    expect(container.querySelector("main")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("reflects the filters in the URL and reloads the counts for the chosen status", async () => {
    setTestUrl("/");
    const statuses: (string | null)[] = [];
    server.use(
      handlerFor("getJobFacets", ({ request }) => {
        statuses.push(new URL(request.url).searchParams.get("status"));
        return HttpResponse.json(syntheticFacets());
      }),
      ...emptyLists(),
    );
    renderWithProviders(<DashboardPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Complete (2)" }));
    expect(getTestUrl()).toBe("/?status=complete");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Complete (2)" })).toHaveAttribute("aria-pressed", "true");
    });
    await userEvent.click(screen.getByRole("button", { name: /^Freehold/ }));
    expect(getTestUrl()).toBe("/?status=complete&type=Freehold");
    expect(statuses).toContain("complete");
  });

  it("shows the archived banner for ?archived= and lets the user dismiss it", async () => {
    setTestUrl("/?archived=S-0001");
    server.use(mockApi("getJobFacets", syntheticFacets()), ...emptyLists());
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText("S-0001 was archived.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(getTestUrl()).toBe("/");
  });

  it("offers NEW JOB to staff, opens the inline form under the header and closes it again", async () => {
    setTestUrl("/");
    server.use(mockApi("getJobFacets", syntheticFacets()), ...emptyLists());
    renderWithProviders(<DashboardPage />);
    const button = await screen.findByRole("button", { name: "New job" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    // The form is loaded on demand (it carries the contract schemas), so it arrives a moment after the click.
    expect(await screen.findByRole("textbox", { name: "Job number" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Job number" })).toBeNull();
    expect(button).toHaveFocus();
  });

  it("does not offer NEW JOB to an external user", async () => {
    setTestUrl("/");
    server.use(mockApi("getJobFacets", syntheticFacets()), ...emptyLists());
    renderWithProviders(<DashboardPage />, { me: syntheticMe("external") });
    await screen.findByRole("button", { name: "In progress (5)" });
    expect(screen.queryByRole("button", { name: "New job" })).toBeNull();
  });

  it("starts from the filters in the URL", async () => {
    setTestUrl("/?status=all&type=Amalgamation");
    server.use(mockApi("getJobFacets", syntheticFacets()), ...emptyLists());
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole("button", { name: "All (7)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Amalgamation/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a problem banner with the request id when the counts cannot be loaded", async () => {
    setTestUrl("/");
    server.use(mockProblem("getJobFacets", 500, PROBLEM_TYPES.internal, { requestId: "req-dash-1" }), ...emptyLists());
    renderWithProviders(<DashboardPage />);
    expect(
      await screen.findByText(
        "The dashboard couldn't be loaded. Reload the page and try again. (Request ID: req-dash-1)",
      ),
    ).toBeInTheDocument();
  });
});
