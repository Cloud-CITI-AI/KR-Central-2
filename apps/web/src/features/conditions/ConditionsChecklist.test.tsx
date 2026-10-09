import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderCard } from "@/features/checkpoints/test-utils";
import { expectNoAxeViolations } from "@/test/axe";
import { checklistCard as group, threeConditions } from "./test-utils";
import { conditionAt, syntheticConditionJob } from "./test-fixtures";

vi.mock("@/features/viewer", () => ({ useViewer: () => ({ open: vi.fn() }) }));

describe("conditions checklist", () => {
  it("lists one card per condition under 'Conditions checklist', open, with the cleared count and where they came from", async () => {
    const job = threeConditions();
    const { container } = renderCard(job, "i5_0");
    const summary = screen.getByText("Conditions checklist").closest("summary");
    expect(summary).toHaveTextContent("1 of 3 cleared");
    expect(summary?.closest("details")).toHaveAttribute("open");
    for (const [index, agency] of ["Western Power", "Water Corporation", "WAPC"].entries()) {
      const card = group(index + 1);
      expect(within(card).getByText(`Condition ${index + 1}`)).toBeInTheDocument();
      expect(within(card).getByText(conditionAt(job, index).text)).toBeInTheDocument();
      expect(within(card).getByText(agency)).toBeInTheDocument();
    }
    expect(
      screen.getByText(
        "Extracted from Decision Letter.pdf · changes here and in each agency section update each other",
      ),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows no checklist before there are conditions", () => {
    renderCard(syntheticConditionJob(), "i5_0");
    expect(screen.queryByText("Conditions checklist")).not.toBeInTheDocument();
  });

  it("collapses and opens again from its summary", async () => {
    renderCard(threeConditions(), "i5_0");
    const details = screen.getByText("Conditions checklist").closest("details");
    await userEvent.click(screen.getByText("Conditions checklist"));
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("Conditions checklist"));
    expect(details).toHaveAttribute("open");
  });

  it("colours an open condition red and a cleared one green, with the cleared text struck through", () => {
    const job = threeConditions();
    renderCard(job, "i5_0");
    expect(group(1)).toHaveAttribute("data-cleared", "false");
    expect(group(2)).toHaveAttribute("data-cleared", "true");
  });

  it("links each card to the stage of its agency", () => {
    renderCard(threeConditions(), "i5_0");
    expect(within(group(1)).getByRole("link", { name: "Go to Western Power ↓" })).toHaveAttribute(
      "href",
      "#western-power",
    );
    expect(within(group(2)).getByRole("link", { name: "Go to Water Corporation ↓" })).toHaveAttribute(
      "href",
      "#water-corporation",
    );
    expect(within(group(3)).getByRole("link", { name: "Go to WAPC ↓" })).toHaveAttribute("href", "#wapc");
  });

  it("flags a guessed agency with a badge that says to check it", () => {
    renderCard(threeConditions(), "i5_0");
    expect(within(group(1)).queryByText("Agency guessed – please check")).not.toBeInTheDocument();
    const badge = within(group(3)).getByText("Agency guessed – please check");
    expect(badge).toHaveAttribute("title", "No agency was named in brackets in the Decision Letter, so it was guessed");
  });
});
