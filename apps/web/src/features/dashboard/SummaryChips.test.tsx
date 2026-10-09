import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { SummaryChips } from "./SummaryChips";
import { syntheticFacets } from "./test-fixtures";

describe("SummaryChips", () => {
  it("shows the four counts of the facets with their labels", async () => {
    const { container } = render(<SummaryChips facets={syntheticFacets({ waitingOnClient: 3, needAttention: 0 })} />);
    const group = screen.getByRole("group", { name: "Summary" });
    expect(group).toHaveTextContent("5 In progress");
    expect(group).toHaveTextContent("2 Complete");
    expect(group).toHaveTextContent("3 Waiting on client");
    expect(group).toHaveTextContent("0 Need attention");
    await expectNoAxeViolations(container);
  });
});
