import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderCard } from "@/features/checkpoints/test-utils";
import { checklistCard as group, serveUpdates, threeConditions } from "./test-utils";
import { conditionAt } from "./test-fixtures";

vi.mock("@/features/viewer", () => ({ useViewer: () => ({ open: vi.fn() }) }));

describe("editing a condition in the checklist", () => {
  it("ticks a condition at once, sends If-Match with its version and refreshes the job", async () => {
    const job = threeConditions();
    const { served } = renderCard(job, "i5_0");
    const calls = serveUpdates(served, 30);
    const target = conditionAt(job, 0);
    await userEvent.click(within(group(1)).getByRole("checkbox", { name: "Condition 1: Open" }));
    expect(await within(group(1)).findByRole("checkbox", { name: "Condition 1: Cleared" })).toBeChecked();
    expect(screen.getByText("Conditions checklist").closest("summary")).toHaveTextContent("2 of 3 cleared");
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toMatchObject({ conditionId: target.id, body: { isCleared: true }, ifMatch: '"1"' });
    await waitFor(() => {
      expect(group(1)).toHaveAttribute("data-cleared", "true");
    });
  });

  it("unticks a cleared condition", async () => {
    const job = threeConditions();
    const { served } = renderCard(job, "i5_0");
    const calls = serveUpdates(served);
    await userEvent.click(within(group(2)).getByRole("checkbox", { name: "Condition 2: Cleared" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toEqual({ isCleared: false });
    expect(within(group(2)).getByText("Open")).toBeInTheDocument();
  });

  it("sets and clears the responsibility", async () => {
    const job = threeConditions();
    const { served } = renderCard(job, "i5_0");
    const calls = serveUpdates(served);
    const select = within(group(1)).getByRole("combobox", { name: "Responsibility for condition 1" });
    expect(select).toHaveValue("");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Unassigned", "KR Surveys", "Client"]);
    await userEvent.selectOptions(select, "Client");
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toEqual({ responsibility: "client" });
    await userEvent.selectOptions(select, "Unassigned");
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]?.body).toEqual({ responsibility: null });
  });
});
