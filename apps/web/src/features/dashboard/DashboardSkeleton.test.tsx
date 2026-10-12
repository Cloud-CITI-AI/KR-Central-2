import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { DashboardSkeleton } from "./DashboardSkeleton";

describe("DashboardSkeleton", () => {
  it("announces only that the dashboard is loading, and marks the region busy", async () => {
    const { container } = render(<DashboardSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading dashboard…");
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    await expectNoAxeViolations(container);
  });

  it("holds the same blocks as the loaded dashboard, in the same order: the header box, the summary chips, then the cards", () => {
    const { container } = render(<DashboardSkeleton />);
    const [status, head, summary, grid] = [...(container.firstElementChild?.children ?? [])];
    expect([status, head, summary, grid].every(Boolean)).toBe(true);
    expect(status).toBe(screen.getByRole("status"));
    expect(grid?.children.length).toBeGreaterThanOrEqual(3);
    for (const block of [head, summary, grid]) expect(block).toHaveAttribute("aria-hidden", "true");
  });
});
