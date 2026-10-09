import { CheckpointKey, type JobCard } from "@kr/contracts";
import { CHECKPOINT_KEYS } from "@kr/workflow";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { DashboardCard } from "./DashboardCard";
import { syntheticJobCard } from "./test-fixtures";

type NextAction = JobCard["nextActions"][number];

/** A next action on a distinct real checkpoint key (the fixture is parsed against the contract). */
function action(
  index: number,
  number: string,
  title: string,
  responsibility: NextAction["responsibility"],
): NextAction {
  const checkpointKey = CheckpointKey.parse(CHECKPOINT_KEYS[index]);
  return { checkpointKey, number, title, stage: "preliminaries", stageName: "Preliminaries", responsibility };
}
const kr = (numbers: readonly string[]) => numbers.map((n, i) => action(i, n, `Item ${n}`, "kr"));

describe("DashboardCard", () => {
  it("shows the job, its progress and the next actions with who is responsible", async () => {
    const job = syntheticJobCard({
      jobNumber: "S-0042",
      address: "12 Example Rd",
      clientName: "Acme Pty Ltd",
      subdivisionType: "Freehold",
      progress: { completed: 23, notCompleted: 20, notRequired: 3, total: 46, percent: 57 },
      nextActions: [
        action(0, "8.0", "Submit for clearance", "kr"),
        action(1, "1.0", "Fee proposal", "client"),
        action(2, "2.1", "Site plan", null),
      ],
    });
    const { container } = render(<DashboardCard job={job} />);
    const card = screen.getByRole("article", { name: "S-0042" });
    expect(within(card).getByText("In progress")).toBeInTheDocument();
    expect(within(card).getByText("57%")).toBeInTheDocument();
    expect(within(card).getByText("12 Example Rd")).toBeInTheDocument();
    expect(within(card).getByText("Acme Pty Ltd · Freehold")).toBeInTheDocument();
    expect(
      within(card).getByRole("img", { name: "23 completed, 3 not required, 20 not completed" }),
    ).toBeInTheDocument();
    expect(within(card).getByText("Next to action")).toBeInTheDocument();
    const items = within(card)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual(["8.0Submit for clearanceKR Surveys", "1.0Fee proposalClient", "2.1Site planUnassigned"]);
    expect(within(card).getByRole("link", { name: "Open job S-0042" })).toHaveAttribute("href", `/jobs/${job.id}`);
    await expectNoAxeViolations(container);
  });

  it("shows alerts above the next actions and only four of them, counting the rest as stages", () => {
    const job = syntheticJobCard({
      alerts: [
        { code: "approval_expired", level: "bad", text: "WAPC approval expired Sun, 14 Jun 2026" },
        { code: "outcome_due", level: "warn", text: "WAPC outcome due in 5 days" },
      ],
      nextActions: kr(["3.0", "4.0", "5.0", "6.0", "7.0", "8.0"]),
    });
    render(<DashboardCard job={job} />);
    expect(screen.getByText("WAPC approval expired Sun, 14 Jun 2026")).toBeInTheDocument();
    expect(screen.getByText("WAPC outcome due in 5 days")).toBeInTheDocument();
    expect(screen.getByText("Item 6.0")).toBeInTheDocument();
    expect(screen.queryByText("Item 7.0")).toBeNull();
    expect(screen.getByText("+ 2 more stages with open items")).toBeInTheDocument();
  });

  it("says + 1 more stage in the singular", () => {
    const job = syntheticJobCard({
      nextActions: kr(["3.0", "4.0", "5.0", "6.0", "7.0"]),
    });
    render(<DashboardCard job={job} />);
    expect(screen.getByText("+ 1 more stage with open items")).toBeInTheDocument();
  });

  it("points at 12.3 when everything open is marked", () => {
    render(<DashboardCard job={syntheticJobCard()} />);
    expect(screen.getByText("Everything open is marked – check 12.3 Plan in order for dealings.")).toBeInTheDocument();
  });

  it("shows a complete job as All done", () => {
    const job = syntheticJobCard({
      isComplete: true,
      progress: { completed: 40, notCompleted: 0, notRequired: 6, total: 46, percent: 100 },
    });
    render(<DashboardCard job={job} />);
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("All done")).toBeInTheDocument();
    expect(screen.getByText("Plan in order for dealings – nothing left to action.")).toBeInTheDocument();
    expect(screen.queryByText(/more stage/)).toBeNull();
  });

  it("leaves out the client and type that are not set", () => {
    render(<DashboardCard job={syntheticJobCard({ clientName: null, subdivisionType: null })} />);
    expect(screen.queryByText(/·/)).toBeNull();
  });
});
