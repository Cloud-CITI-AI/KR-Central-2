import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderCard } from "./test-utils";

const STATUS_BUTTONS = ["Completed", "Not completed", "Not required"];

function recordBodies() {
  const bodies: unknown[] = [];
  server.use(
    handlerFor("updateCheckpoint", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({}, { status: 500 });
    }),
  );
  return bodies;
}

describe("CheckpointControls", () => {
  it("shows the status buttons with the effective status pressed and the responsibility selected", async () => {
    const job = syntheticJob({ statuses: { i4_1: "completed" } });
    const { container } = renderCard(job, "i4_1");
    const group = screen.getByRole("group", { name: "Status for 4.1" });
    expect([...group.querySelectorAll("button")].map((b) => b.textContent)).toEqual(STATUS_BUTTONS);
    expect(screen.getByRole("button", { name: "Completed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Not completed" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("combobox", { name: "Responsibility for 4.1" })).toHaveValue("client");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Unassigned",
      "KR Surveys",
      "Client",
      "Architect",
    ]);
    await expectNoAxeViolations(container);
  });

  it("sends nothing when the pressed status is pressed again", async () => {
    renderCard(syntheticJob(), "i4_0");
    const bodies = recordBodies();
    await userEvent.click(screen.getByRole("button", { name: "Not completed" }));
    expect(bodies).toEqual([]);
  });

  it("saves a responsibility, and Unassigned as null", async () => {
    renderCard(syntheticJob(), "i4_0");
    const bodies = recordBodies();
    await userEvent.selectOptions(screen.getByRole("combobox"), "Architect");
    await waitFor(() => {
      expect(bodies).toEqual([{ responsibility: "architect" }]);
    });
    await userEvent.selectOptions(screen.getByRole("combobox"), "Unassigned");
    await waitFor(() => {
      expect(bodies).toContainEqual({ responsibility: null });
    });
  });

  it.each([
    ["a client", { role: "external", grantRole: "client" }],
    ["an architect", { role: "external", grantRole: "architect" }],
  ] as const)("disables the controls for %s, who has no edit capability", async (_who, options) => {
    const { container } = renderCard(syntheticJob(options), "i4_0");
    for (const name of STATUS_BUTTONS) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
    await expectNoAxeViolations(container);
  });

  it("disables the controls of a fee proposal the viewer cannot see", () => {
    const job = syntheticJob();
    renderCard(
      { ...job, checkpoints: job.checkpoints.map((c) => (c.key === "i1_0p" ? { ...c, isRestricted: true } : c)) },
      "i1_0p",
    );
    expect(screen.getByRole("button", { name: "Completed" })).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
