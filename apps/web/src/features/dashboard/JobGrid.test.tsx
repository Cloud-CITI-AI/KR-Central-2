import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { JobGrid } from "./JobGrid";
import { parseDashboardParams } from "./params";
import { syntheticJobCard } from "./test-fixtures";

const params = (query = "") => parseDashboardParams(new URLSearchParams(query));
const page = (jobNumbers: readonly string[], nextCursor: string | null = null) => ({
  items: jobNumbers.map((jobNumber) => syntheticJobCard({ jobNumber })),
  nextCursor,
});

describe("JobGrid", () => {
  it("shows the cards in the order the API sorted them and asks for the filters in the URL", async () => {
    const asked: URLSearchParams[] = [];
    server.use(
      handlerFor("listJobs", ({ request }) => {
        asked.push(new URL(request.url).searchParams);
        return HttpResponse.json(page(["S-0003", "S-0001", "S-0002"]));
      }),
    );
    const { container } = renderWithProviders(
      <JobGrid params={params("status=complete&type=Freehold&q=main")} visibleJobs={3} />,
    );
    const list = await screen.findByRole("list");
    expect(
      within(list)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Open job → S-0003", "Open job → S-0001", "Open job → S-0002"]);
    expect(Object.fromEntries(asked[0] ?? [])).toEqual({
      status: "complete",
      type: "Freehold",
      q: "main",
      sort: "attention",
      limit: "50",
    });
    await expectNoAxeViolations(container);
  });

  it("is keyboard navigable: Tab walks the Open job links in card order", async () => {
    server.use(mockApi("listJobs", page(["S-0003", "S-0001"])));
    renderWithProviders(<JobGrid params={params()} visibleJobs={2} />);
    await screen.findByRole("list");
    await userEvent.tab();
    expect(screen.getByRole("link", { name: "Open job S-0003" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("link", { name: "Open job S-0001" })).toHaveFocus();
  });

  it("shows placeholders while the cards load", () => {
    server.use(handlerFor("listJobs", () => new Promise<never>(() => undefined)));
    renderWithProviders(<JobGrid params={params()} visibleJobs={undefined} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading jobs…");
    // Decoration only, enough of them to fill a screen of cards so the footer is not pushed when the real ones arrive.
    const boxes = [...status.querySelectorAll('[aria-hidden="true"]')];
    expect(boxes.length).toBeGreaterThanOrEqual(6);
  });

  it("says No jobs match. when the filters find nothing", async () => {
    server.use(mockApi("listJobs", page([])));
    renderWithProviders(<JobGrid params={params("q=zzz")} visibleJobs={4} />);
    expect(await screen.findByText("No jobs match.")).toBeInTheDocument();
  });

  it("tells an external user with no grants they have no access yet", async () => {
    server.use(mockApi("listJobs", page([])));
    renderWithProviders(<JobGrid params={params()} visibleJobs={0} />, { me: syntheticMe("external") });
    expect(
      await screen.findByText("You don't have access to any jobs yet — ask your KR Surveys contact."),
    ).toBeInTheDocument();
  });

  it("keeps No jobs match. for an external user who has jobs but no match", async () => {
    server.use(mockApi("listJobs", page([])));
    renderWithProviders(<JobGrid params={params("q=zzz")} visibleJobs={2} />, { me: syntheticMe("external") });
    expect(await screen.findByText("No jobs match.")).toBeInTheDocument();
  });

  it("loads the next page with the cursor and appends it, then stops offering more", async () => {
    const cursors: (string | null)[] = [];
    server.use(
      handlerFor("listJobs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return HttpResponse.json(cursor ? page(["S-0002"]) : page(["S-0001"], "next-1"));
      }),
    );
    renderWithProviders(<JobGrid params={params()} visibleJobs={2} />);
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("link", { name: "Open job S-0002" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open job S-0001" })).toBeInTheDocument();
    expect(cursors).toEqual([null, "next-1"]);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });
  });

  it("moves focus to the first new card when 'Load more' has loaded it, instead of dropping it with the disabled button", async () => {
    server.use(
      handlerFor("listJobs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        return HttpResponse.json(cursor ? page(["S-0002", "S-0003"]) : page(["S-0001"], "next-1"));
      }),
    );
    renderWithProviders(<JobGrid params={params()} visibleJobs={3} />);
    const more = await screen.findByRole("button", { name: "Load more" });
    more.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("link", { name: "Open job S-0002" })).toHaveFocus();
  });

  it("puts focus back on 'Load more' when the next page cannot be loaded", async () => {
    server.use(
      handlerFor("listJobs", ({ request }) =>
        new URL(request.url).searchParams.get("cursor")
          ? HttpResponse.json({ title: "no" }, { status: 500 })
          : HttpResponse.json(page(["S-0001"], "next-1")),
      ),
    );
    renderWithProviders(<JobGrid params={params()} visibleJobs={3} />);
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Load more" })).toHaveFocus();
    });
  });

  it("shows nothing but leaves the failure to the dashboard's banner when the cards cannot be loaded", async () => {
    server.use(mockProblem("listJobs", 500, PROBLEM_TYPES.internal, { requestId: "req-grid-1" }));
    const { container } = renderWithProviders(<JobGrid params={params()} visibleJobs={1} />);
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Request ID/)).toBeNull();
  });
});
