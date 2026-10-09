import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { renderCard } from "@/features/checkpoints/test-utils";
import { MESSAGES } from "@/lib/messages";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { checklistCard as group, serveUpdates, threeConditions } from "./test-utils";
import { conditionAt, syntheticConditionJob, withCondition } from "./test-fixtures";

vi.mock("@/features/viewer", () => ({ useViewer: () => ({ open: vi.fn() }) }));

describe("writing a condition", () => {
  it("sends a second edit with the version the first one made", async () => {
    const job = threeConditions();
    const { served } = renderCard(job, "i5_0");
    const calls = serveUpdates(served, 40);
    await userEvent.click(within(group(1)).getByRole("checkbox", { name: "Condition 1: Open" }));
    await userEvent.selectOptions(
      within(group(1)).getByRole("combobox", { name: "Responsibility for condition 1" }),
      "KR Surveys",
    );
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls.map((c) => c.ifMatch)).toEqual(['"1"', '"2"']);
  });

  it("puts a refused tick back, reloads the job and says it changed under the person on a 412", async () => {
    const job = threeConditions();
    const { served } = renderCard(job, "i5_0");
    const target = conditionAt(job, 0);
    served.job = withCondition(job, target.id, { isCleared: true, version: 3, responsibility: "kr" });
    server.use(mockProblem("updateCondition", 412, PROBLEM_TYPES.preconditionFailed));
    await userEvent.click(within(group(1)).getByRole("checkbox", { name: "Condition 1: Open" }));
    expect(await screen.findByText(MESSAGES.stale)).toBeInTheDocument();
    expect(within(group(1)).getByRole("combobox", { name: "Responsibility for condition 1" })).toHaveValue("kr");
    expect(group(1)).toHaveAttribute("data-cleared", "true");
  });

  it("treats a condition replaced by a new extraction (404) like a stale one: reload and say so", async () => {
    const job = threeConditions();
    const { served } = renderCard(job, "i5_0");
    const replaced = syntheticConditionJob({ agencies: ["WAPC"], fields: { id: job.id } });
    server.use(
      handlerFor("updateCondition", () => {
        served.job = replaced;
        return HttpResponse.json(
          { type: PROBLEM_TYPES.notFound, title: "Not found", status: 404, requestId: "req-test-0001" },
          { status: 404, headers: { "content-type": "application/problem+json" } },
        );
      }),
    );
    await userEvent.click(within(group(1)).getByRole("checkbox", { name: "Condition 1: Open" }));
    expect(await screen.findByText(MESSAGES.stale)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Conditions checklist").closest("summary")).toHaveTextContent("0 of 1 cleared");
    });
    expect(screen.queryByRole("group", { name: "Condition 2" })).not.toBeInTheDocument();
  });

  it("puts the change back and shows the save-failed banner with the request id on any other failure", async () => {
    const job = threeConditions();
    renderCard(job, "i5_0");
    server.use(mockProblem("updateCondition", 500));
    await userEvent.click(within(group(1)).getByRole("checkbox", { name: "Condition 1: Open" }));
    expect(await screen.findByText(/A change couldn't be saved\./)).toHaveTextContent("Request ID: req-test-0001");
    expect(group(1)).toHaveAttribute("data-cleared", "false");
  });
});
