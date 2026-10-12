import { STAGES } from "@kr/workflow";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { TrackerSkeleton } from "./TrackerSkeleton";

describe("TrackerSkeleton", () => {
  it("announces only that the job is loading, and marks the page busy", async () => {
    const { container } = render(<TrackerSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading job…");
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    await expectNoAxeViolations(container);
  });

  it("holds the same blocks as the loaded tracker, in the same order, so the page keeps its height: jobbar row, two summary panels, the tools row, one bar per stage, notes and files", () => {
    const { container } = render(<TrackerSkeleton />);
    const [jobbar, summary, tools, stages, after] = [...(container.firstElementChild?.children ?? [])];
    expect([jobbar, summary, tools, stages, after].every(Boolean)).toBe(true);
    expect(jobbar).toContainElement(screen.getByRole("status"));
    expect(summary?.children).toHaveLength(2);
    expect(tools?.children).toHaveLength(0);
    expect(stages?.children).toHaveLength(STAGES.length);
    expect(after?.children).toHaveLength(2);
    for (const block of [summary, tools, stages, after]) expect(block).toHaveAttribute("aria-hidden", "true");
  });
});
