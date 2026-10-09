import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { checkpointOf, renderCard, withCheckpoint } from "./test-utils";

const DECIDED_AT = "2026-09-28T03:50:56.543Z";
const decided = (job: ReturnType<typeof syntheticJob>, key: string, value: "accepted" | "declined", comment = "") =>
  withCheckpoint(job, key, { decision: { value, comment, at: DECIDED_AT, by: null } });

/** The API answers a decision with the checkpoint carrying it, status untouched; `served` then holds the same. */
function answerDecision(job: ReturnType<typeof syntheticJob>, key: string, served: { job: typeof job }) {
  const bodies: unknown[] = [];
  server.use(
    handlerFor("recordDecision", async ({ request }) => {
      const body = (await request.json()) as { value: "accepted" | "declined"; comment: string };
      bodies.push(body);
      served.job = decided(job, key, body.value, body.comment);
      return HttpResponse.json(checkpointOf(served.job, key));
    }),
  );
  return bodies;
}

describe("approval panel: the decision buttons", () => {
  it.each([
    ["i1_0p", "Approve fee proposal", "Decline fee proposal", "Client decision"],
    ["i3_0p", "Approve WAPC proposal", "Decline WAPC proposal", "Client decision"],
    ["i6_1a", "Accept quote", "Decline quote", "Client decision"],
    ["i9_1", "Accept quote", "Decline quote", "Client response"],
  ])("%s offers “%s” and “%s” under the label %s", async (key, yes, no, label) => {
    const { container } = renderCard(syntheticJob(), key);
    expect(screen.getByRole("button", { name: yes })).toBeEnabled();
    expect(screen.getByRole("button", { name: no })).toBeEnabled();
    expect(screen.getByText(label)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("disables the buttons without checkpoint.decision.record (an architect)", () => {
    renderCard(syntheticJob({ role: "external", grantRole: "architect" }), "i6_1a");
    expect(screen.getByRole("button", { name: "Accept quote" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline quote" })).toBeDisabled();
  });

  it("lets the client decide", () => {
    renderCard(syntheticJob({ role: "external", grantRole: "client" }), "i6_1a");
    expect(screen.getByRole("button", { name: "Accept quote" })).toBeEnabled();
  });
});

describe("approval panel: recording a decision", () => {
  it("opens the form focused with the optional comment, and Cancel closes it", async () => {
    renderCard(syntheticJob(), "i1_0p");
    await userEvent.click(screen.getByRole("button", { name: "Approve fee proposal" }));
    const box = screen.getByRole("textbox", { name: "Approve the fee proposal" });
    expect(box).toHaveAttribute("placeholder", "Comment (optional)");
    expect(box).toHaveFocus();
    expect(screen.getByRole("button", { name: "Confirm approval" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve fee proposal" })).toBeInTheDocument();
  });

  it("approves, shows the result box with the date and leaves the status as it was", async () => {
    const job = syntheticJob();
    const { served } = renderCard(job, "i1_0p");
    const bodies = answerDecision(job, "i1_0p", served);
    await userEvent.click(screen.getByRole("button", { name: "Approve fee proposal" }));
    await userEvent.type(screen.getByRole("textbox"), "  Looks fine  ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(await screen.findByText("Client approved the fee proposal")).toBeInTheDocument();
    expect(screen.getByText("28 Sep 2026")).toBeInTheDocument();
    expect(screen.getByText("“Looks fine”")).toBeInTheDocument();
    expect(bodies).toEqual([{ value: "accepted", comment: "Looks fine" }]);
    expect(screen.getByRole("button", { name: "Not completed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
