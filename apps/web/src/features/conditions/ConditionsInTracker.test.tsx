import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackerPage } from "@/features/tracker";
import { jobPage } from "@/features/tracker/test-fixtures";
import { renderTracker, WHOLE_TRACKER_TIMEOUT_MS } from "@/features/tracker/test-utils";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { serveUpdates } from "./test-utils";
import { syntheticConditionJob } from "./test-fixtures";

vi.mock("next/navigation", async () => (await import("@/features/tracker/test-utils")).navigationMock);
vi.mock("@/features/viewer", () => ({ useViewer: () => ({ open: vi.fn() }) }));

const scrollIntoView = vi.fn();
beforeEach(() => {
  localStorage.clear();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** The body element of a stage. */
function bodyOf(stage: string): HTMLElement {
  const body = document.getElementById(`body-${stage}`);
  if (!body) throw new Error(stage);
  return body;
}

/** Western Power and WAPC have conditions; the other three agency stages are then excluded (R1). */
const job = syntheticConditionJob({ agencies: ["Western Power", "WAPC"], conditions: [{ agencyGuessed: true }, {}] });

describe("the conditions inside the tracker", { timeout: WHOLE_TRACKER_TIMEOUT_MS }, () => {
  it("puts each agency's box first in its stage, the checklist in 5.0, and excludes the agencies without conditions", async () => {
    server.use(mockApi("getJob", job), mockApi("listJobs", jobPage([])));
    const { container } = renderTracker(<TrackerPage jobId={job.id} />);
    await screen.findByRole("combobox", { name: "Job" });
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));

    expect(within(bodyOf("wapc-approval")).getByText("Conditions checklist")).toBeInTheDocument();
    for (const [id, agency] of [
      ["western-power", "Western Power"],
      ["wapc", "WAPC"],
    ] as const) {
      expect(bodyOf(id).firstElementChild).toHaveAccessibleName(`WAPC conditions – ${agency}`);
    }
    expect(screen.getAllByText(/Not required – no conditions in the Decision Letter/)).toHaveLength(3);
    expect(document.getElementById("body-water-corporation")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("'Go to Western Power ↓' opens that stage and scrolls to it, and 'Checklist ↑' goes back", async () => {
    server.use(mockApi("getJob", job), mockApi("listJobs", jobPage([])));
    renderTracker(<TrackerPage jobId={job.id} />);
    await screen.findByRole("combobox", { name: "Job" });
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    await userEvent.click(screen.getByRole("button", { name: /^WAPC Approval/i }));
    await userEvent.click(screen.getByRole("link", { name: "Go to Western Power ↓" }));
    const bar = screen.getByRole("button", { name: /^Western Power/i });
    await waitFor(() => {
      expect(bar).toHaveAttribute("aria-expanded", "true");
    });
    expect(scrollIntoView.mock.contexts.map((element) => (element as HTMLElement).id)).toContain("western-power");
    await userEvent.click(screen.getByRole("button", { name: /^WAPC Approval/i }));
    await userEvent.click(
      within(screen.getByRole("group", { name: "WAPC conditions – Western Power" })).getByRole("link", {
        name: "Checklist ↑",
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^WAPC Approval/i })).toHaveAttribute("aria-expanded", "true");
    });
    expect(scrollIntoView.mock.contexts.map((element) => (element as HTMLElement).id)).toContain("wapc-approval");
  });

  it("keeps the checklist and the agency box in step when a condition is ticked", async () => {
    const state = { job };
    server.use(
      handlerFor("getJob", () => HttpResponse.json(state.job)),
      mockApi("listJobs", jobPage([])),
    );
    serveUpdates(state);
    renderTracker(<TrackerPage jobId={job.id} />);
    await screen.findByRole("combobox", { name: "Job" });
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    const box = within(screen.getByRole("group", { name: "WAPC conditions – Western Power" }));
    await userEvent.click(box.getByRole("checkbox", { name: "Condition 1: Open" }));
    await waitFor(() => {
      expect(within(screen.getByRole("group", { name: "Condition 1" })).getByRole("checkbox")).toBeChecked();
    });
    expect(box.getByText("1 of 1 cleared")).toBeInTheDocument();
  });
});
