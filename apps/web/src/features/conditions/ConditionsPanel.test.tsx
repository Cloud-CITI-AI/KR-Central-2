import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticFile } from "@/features/checkpoints/test-fixtures";
import { renderCard, withCheckpoint } from "@/features/checkpoints/test-utils";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticConditionJob } from "./test-fixtures";

vi.mock("@/features/viewer", () => ({ useViewer: () => ({ open: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const file = (jobId: string, name: string, overrides: Parameters<typeof syntheticFile>[1] = {}) =>
  syntheticFile(jobId, { name, checkpointKey: "i5_0", slot: "decision", ...overrides });
const withFiles = (names: string[], options: Parameters<typeof syntheticConditionJob>[0] = {}) => {
  const base = syntheticConditionJob(options);
  return withCheckpoint(base, "i5_0", { files: names.map((name) => file(base.id, name)) });
};

describe("conditions panel: the folder", () => {
  it("shows the empty folder with its PDF zone and no extract button", async () => {
    const { container } = renderCard(syntheticConditionJob(), "i5_0");
    expect(screen.getByText("WAPC conditional approval")).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.getByText("Drag and drop the WAPC conditional approval PDF here")).toBeInTheDocument();
    expect(screen.getByText("then extract its conditions")).toBeInTheDocument();
    expect(screen.getByLabelText(/Drag and drop the WAPC conditional approval PDF here/)).toHaveAttribute(
      "accept",
      ".pdf",
    );
    expect(screen.queryByRole("button", { name: /Extract/ })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("gives a client no extract button and no zone but still lists the letter", async () => {
    const { container } = renderCard(
      withFiles(["Decision Letter.pdf"], { role: "external", grantRole: "client" }),
      "i5_0",
    );
    expect(screen.queryByRole("button", { name: /xtract/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Drag and drop the WAPC conditional approval PDF here")).not.toBeInTheDocument();
    expect(screen.getByText("Decision Letter.pdf")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("tells a viewer who cannot upload where the letter goes while the folder is empty", () => {
    renderCard(syntheticConditionJob({ role: "external", grantRole: "architect" }), "i5_0");
    const group = screen.getByRole("group", { name: "5.0 WAPC conditional approval received" });
    expect(within(group).getByText("The WAPC conditional approval PDF goes here.")).toBeInTheDocument();
  });
});
