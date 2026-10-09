import { CHECKPOINTS, STATUS_LABELS } from "@kr/workflow";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { CHECKPOINT_MESSAGES } from "./messages";
import { renderCard } from "./test-utils";

describe("CheckpointCard", () => {
  it.each(CHECKPOINTS.map((c) => [c.number, c.key, c.title] as const))(
    "renders %s with its number, title, status and description",
    (number, key, title) => {
      const definition = CHECKPOINTS.find((c) => c.key === key);
      const { container } = renderCard(syntheticJob(), key);
      const group = screen.getByRole("group", { name: `${number} ${title}` });
      expect(group).toHaveAttribute("data-checkpoint", key);
      expect(within(group).getByText(STATUS_LABELS.not_completed)).toBeInTheDocument();
      if (definition?.description) expect(screen.getByText(definition.description)).toBeInTheDocument();
      expect(container.querySelectorAll("[data-checkpoint]")).toHaveLength(1);
    },
  );

  it("colours by the effective status and labels it", () => {
    const job = syntheticJob({ statuses: { i4_0: "completed", i4_1: "not_required" } });
    const done = renderCard(job, "i4_0");
    expect(screen.getByRole("group")).toHaveAttribute("data-s", "completed");
    expect(screen.getByText("Completed")).toBeInTheDocument();
    done.unmount();
    renderCard(job, "i4_1");
    expect(screen.getByRole("group")).toHaveAttribute("data-s", "not_required");
    expect(screen.getByText("Not required")).toBeInTheDocument();
  });

  it("shows the effective status of a checkpoint in an excluded agency stage as Not required", () => {
    renderCard(syntheticJob({ conditionAgencies: ["Water Corporation"] }), "i6_0");
    expect(screen.getByRole("group")).toHaveAttribute("data-s", "not_required");
  });

  it("shows the claim tag in capitals and the fee tags by who pays", () => {
    const claim = renderCard(syntheticJob(), "i4_0");
    expect(screen.getByText("ITEM 2 PAYMENT REQUIRED")).toBeInTheDocument();
    expect(screen.getByTitle("KR progress claim")).toBeInTheDocument();
    claim.unmount();
    const client = renderCard(syntheticJob(), "i4_1");
    expect(screen.getByText("$ WAPC Form 1A payment")).toBeInTheDocument();
    expect(screen.getByTitle("Client payment")).toBeInTheDocument();
    client.unmount();
    renderCard(syntheticJob(), "i6_0");
    expect(screen.getByText("$ WP connection fee")).toBeInTheDocument();
    expect(screen.getByTitle("KR payment")).toBeInTheDocument();
  });

  it("has no tags when the definition has none", () => {
    renderCard(syntheticJob(), "i4_3");
    expect(screen.queryByTitle(/payment/)).not.toBeInTheDocument();
  });

  it("replaces the panels of the restricted fee proposal with one line of text", async () => {
    const job = syntheticJob({ role: "staff" });
    const restricted = {
      ...job,
      checkpoints: job.checkpoints.map((c) => (c.key === "i1_0p" ? { ...c, isRestricted: true } : c)),
    };
    const { container } = renderCard(restricted, "i1_0p");
    const group = screen.getByRole("group", { name: "1.0 Fee proposal" });
    expect(within(group).getByText(CHECKPOINT_MESSAGES.restricted)).toBeInTheDocument();
    expect(
      within(group).getByText("Fee proposal ready for client review. Open the document, then approve or decline"),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("renders the conditions panel from the conditions feature on 5.0", () => {
    const { container } = renderCard(syntheticJob({ conditionAgencies: ["WAPC"] }), "i5_0");
    expect(container.querySelector("[data-conditions-count='1']")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderCard(syntheticJob(), "i4_1");
    await expectNoAxeViolations(container);
  });
});
