import { STAGES } from "@kr/workflow";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { OPEN_STAGES_KEY } from "./openStages";
import { jobPage, syntheticJob } from "./test-fixtures";
import { renderTracker, WHOLE_TRACKER_TIMEOUT_MS } from "./test-utils";
import { TrackerBody } from "./TrackerBody";

vi.mock("next/navigation", async () => (await import("./test-utils")).navigationMock);

const keysOf = (stage: string) => STAGES.find((s) => s.key === stage)?.checkpoints.map((c) => c.key) ?? [];
const all = (stage: string, status: "completed" | "not_required") =>
  Object.fromEntries(keysOf(stage).map((key) => [key, status]));

function show(job = syntheticJob()) {
  server.use(mockApi("listJobs", jobPage([])));
  return renderTracker(<TrackerBody job={job} />);
}
/** The stage bar: the one button of the section that controls its body (open cards hold buttons of their own). */
const bar = (stage: string) => {
  const section = document.getElementById(stage);
  const button = section?.querySelector<HTMLButtonElement>("button[aria-controls]");
  if (!button) throw new Error(`No stage ${stage}`);
  return button;
};

describe("Stages", { timeout: WHOLE_TRACKER_TIMEOUT_MS }, () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the ten stage bars, collapsed, with to-do counts and percentages", async () => {
    const { container } = show();
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(STAGES.length);
    expect(bar("water-corporation")).toHaveAccessibleName("Water Corporation 7 to do 0%");
    expect(bar("preliminaries")).toHaveTextContent("2 to do");
    expect(bar("preliminaries")).toHaveTextContent("0%");
    expect(bar("titles")).toHaveTextContent("1 to do");
    await expectNoAxeViolations(container);
  });

  it("makes every stage bar a level-2 heading wrapping its button, so the outline is stages then checkpoints", async () => {
    show(syntheticJob({ conditionAgencies: ["Western Power", "WAPC"] }));
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    const headings = screen.getAllByRole("heading", { level: 2 });
    for (const stage of STAGES) {
      const section = document.getElementById(stage.key);
      const heading = section?.querySelector("h2");
      expect(heading, stage.name).not.toBeNull();
      expect(heading).toHaveTextContent(stage.name);
      expect(headings).toContain(heading);
      expect(heading?.parentElement).toBe(section);
      // the button keeps aria-expanded, and an excluded stage (no button) is a heading too
      const button = heading?.querySelector("button");
      if (button) expect(button).toHaveAttribute("aria-expanded", "true");
    }
    expect(document.querySelector("#water-corporation h2 button")).toBeNull();
    // checkpoint cards stay below the stages in the outline
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(
      document.querySelectorAll("[data-checkpoint]").length,
    );
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
  });

  it("colours a bar by its stage state and labels Complete and Not required", () => {
    show(syntheticJob({ statuses: { ...all("preliminaries", "completed"), ...all("titles", "not_required") } }));
    expect(bar("preliminaries")).toHaveTextContent("Complete");
    expect(bar("preliminaries")).toHaveAttribute("data-state", "completed");
    expect(bar("preliminaries")).toHaveTextContent("100%");
    expect(bar("titles")).toHaveAttribute("data-state", "not_required");
    expect(bar("titles")).toHaveTextContent("Not required");
    expect(bar("survey")).toHaveAttribute("data-state", "not_completed");
  });

  it("opens and closes a stage from its bar with aria-expanded and aria-controls, and remembers it", async () => {
    show();
    const wapc = bar("wapc-approval");
    const body = document.getElementById(wapc.getAttribute("aria-controls") ?? "");
    expect(body).not.toBeNull();
    expect(body).toHaveAttribute("hidden");
    await userEvent.click(wapc);
    expect(wapc).toHaveAttribute("aria-expanded", "true");
    expect(body).not.toHaveAttribute("hidden");
    expect(localStorage.getItem(OPEN_STAGES_KEY)).toBe('["wapc-approval"]');
    await userEvent.click(wapc);
    expect(wapc).toHaveAttribute("aria-expanded", "false");
  });

  it("restores the stages remembered from last time", () => {
    localStorage.setItem(OPEN_STAGES_KEY, '["survey"]');
    show();
    expect(bar("survey")).toHaveAttribute("aria-expanded", "true");
    expect(bar("landgate")).toHaveAttribute("aria-expanded", "false");
  });

  it("Expand all and Collapse all", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(10);
    await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });

  it("shows an excluded agency stage as a disabled grey bar with the Decision Letter reason and no body", () => {
    show(syntheticJob({ conditionAgencies: ["Western Power", "WAPC"] }));
    const stage = document.getElementById("water-corporation");
    expect(stage).not.toBeNull();
    expect(stage && within(stage).queryByRole("button")).toBeNull();
    expect(stage?.querySelector("[title]")).toHaveAttribute(
      "title",
      "The Decision Letter has no conditions for Water Corporation",
    );
    expect(stage).toHaveTextContent("Not required – no conditions in the Decision Letter");
    expect(stage?.querySelector("#body-water-corporation")).toBeNull();
    expect(bar("western-power")).toHaveAttribute("data-state", "not_completed");
    expect(document.getElementById("busselton-water")).toHaveTextContent("Not required – no conditions");
  });

  it("Save as PDF in the jobbar expands every stage", async () => {
    vi.spyOn(window, "print").mockImplementation(() => undefined);
    show();
    await userEvent.click(screen.getByRole("button", { name: "Save as PDF" }));
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(10);
  });
});
