import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";
import { DashboardHeader } from "./DashboardHeader";
import { parseDashboardParams } from "./params";
import { syntheticFacets } from "./test-fixtures";

const params = (query = "") => parseDashboardParams(new URLSearchParams(query));

describe("DashboardHeader", () => {
  it("shows the status filter and type chips with their counts and the pressed choices", async () => {
    const { container } = renderWithProviders(
      <DashboardHeader params={params("type=Freehold")} facets={syntheticFacets()} onChange={() => undefined} />,
    );
    const show = screen.getByRole("group", { name: "Show" });
    expect(within(show).getByRole("button", { name: "In progress (5)" })).toHaveAttribute("aria-pressed", "true");
    expect(within(show).getByRole("button", { name: "Complete (2)" })).toHaveAttribute("aria-pressed", "false");
    expect(within(show).getByRole("button", { name: "All (7)" })).toBeInTheDocument();
    const types = screen.getByRole("group", { name: "Subdivision type" });
    expect(
      within(types)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "All types5",
      "Survey-Strata3",
      "Built Strata0",
      "Amalgamation1",
      "Freehold1",
      "Strata Conversion0",
      "Re-Subdivision0",
    ]);
    expect(within(types).getByRole("button", { name: /^Freehold/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Subdivision dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search jobs" })).toHaveAttribute(
      "placeholder",
      "Search job, address or client",
    );
    await expectNoAxeViolations(container);
  });

  it("renders without numbers while the counts load", () => {
    renderWithProviders(<DashboardHeader params={params()} facets={undefined} onChange={() => undefined} />);
    expect(screen.getByRole("button", { name: "In progress" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All types" })).toBeInTheDocument();
  });

  it("reports a status choice and toggles a type chip on and off", async () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <DashboardHeader params={params()} facets={syntheticFacets()} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Complete (2)" }));
    expect(onChange).toHaveBeenLastCalledWith({ status: "complete" });
    await userEvent.click(screen.getByRole("button", { name: /^Freehold/ }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "Freehold" });
    rerender(<DashboardHeader params={params("type=Freehold")} facets={syntheticFacets()} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /^Freehold/ }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "" });
    await userEvent.click(screen.getByRole("button", { name: /^All types/ }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "" });
  });

  it("reports the search text once typing pauses", async () => {
    const onChange = vi.fn();
    renderWithProviders(<DashboardHeader params={params()} facets={undefined} onChange={onChange} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search jobs" }), "lot 5");
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(onChange).toHaveBeenCalledWith({ q: "lot 5" });
  });

  it("puts the URL's search text back in the box when it changes (back/forward)", () => {
    const { rerender } = renderWithProviders(
      <DashboardHeader params={params("q=old")} facets={undefined} onChange={() => undefined} />,
    );
    expect(screen.getByRole("searchbox", { name: "Search jobs" })).toHaveValue("old");
    rerender(<DashboardHeader params={params("q=new")} facets={undefined} onChange={() => undefined} />);
    expect(screen.getByRole("searchbox", { name: "Search jobs" })).toHaveValue("new");
  });
});
