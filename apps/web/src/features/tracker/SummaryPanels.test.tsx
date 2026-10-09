import { screen, within } from "@testing-library/react";
import { CHECKPOINTS } from "@kr/workflow";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { SummaryPanels } from "./SummaryPanels";
import { syntheticJob } from "./test-fixtures";
import { renderTracker } from "./test-utils";

const jobWith = (completed: number, notRequired: number) =>
  syntheticJob({
    statuses: Object.fromEntries(
      CHECKPOINTS.slice(0, completed + notRequired).map((c, i) => [
        c.key,
        i < completed ? "completed" : "not_required",
      ]),
    ),
  });

describe("SummaryPanels", () => {
  it("shows a blank job as 0% with 46 not completed", async () => {
    const { container } = renderTracker(<SummaryPanels job={syntheticJob()} />);
    const progress = screen.getByRole("region", { name: "Subdivision progress" });
    expect(within(progress).getByText("0%")).toBeInTheDocument();
    expect(within(progress).getByRole("img")).toHaveAccessibleName(
      "0 completed, 0 not required, 46 not completed of 46",
    );
    expect(progress).toHaveTextContent("0 Completed");
    expect(progress).toHaveTextContent("46 Not completed");
    expect(progress).toHaveTextContent("0 Not required");
    await expectNoAxeViolations(container);
  });

  it("shows percent, bar and chips from the job's summary: round((completed + not required) / 46)", () => {
    const job = jobWith(4, 3);
    renderTracker(<SummaryPanels job={job} />);
    const { completed, notRequired, notCompleted, percent } = job.summary.progress;
    expect([completed, notRequired, percent]).toEqual([4, 3, 15]);
    const progress = screen.getByRole("region", { name: "Subdivision progress" });
    expect(within(progress).getByText("15%")).toBeInTheDocument();
    expect(within(progress).getByRole("img")).toHaveAccessibleName(
      `4 completed, 3 not required, ${notCompleted} not completed of 46`,
    );
    expect(progress).toHaveTextContent("4 Completed");
    expect(progress).toHaveTextContent("3 Not required");
  });

  it("shows 100% for a job with every checkpoint completed", () => {
    const job = syntheticJob({
      statuses: Object.fromEntries(syntheticJob().checkpoints.map((c) => [c.key, "completed"])),
    });
    renderTracker(<SummaryPanels job={job} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Subdivision progress" })).toHaveTextContent("46 Completed");
  });

  it("shows the status key with the three statuses and the three tags", () => {
    renderTracker(<SummaryPanels job={syntheticJob()} />);
    const key = screen.getByRole("region", { name: "Status key" });
    expect(key).toHaveTextContent(
      "CompletedNot completedNot requiredITEM KR progress claim$ KR payment$ Client payment",
    );
    expect(within(key).queryByRole("button")).toBeNull();
  });

  it("holds only progress and the two approval date inputs, and no other control", () => {
    const { container } = renderTracker(<SummaryPanels job={syntheticJob()} />);
    const inputs = [...container.querySelectorAll("input, select, textarea, button")];
    expect(inputs.map((i) => i.getAttribute("type"))).toEqual(["date", "date"]);
  });
});
