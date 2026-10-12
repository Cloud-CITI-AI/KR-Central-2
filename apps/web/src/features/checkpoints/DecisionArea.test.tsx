import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { draftKey } from "@/lib/api";
import { navigation } from "@/lib/navigation";
import { MESSAGES } from "@/lib/messages";
import { syntheticMe } from "@/test/fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
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

  it("accepts a quote: Confirm acceptance, then “Client accepted the quote”", async () => {
    const job = syntheticJob();
    const { served } = renderCard(job, "i6_1a");
    answerDecision(job, "i6_1a", served);
    await userEvent.click(screen.getByRole("button", { name: "Accept quote" }));
    expect(screen.getByRole("textbox", { name: "Accept the quote" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm acceptance" }));
    expect(await screen.findByText("Client accepted the quote")).toBeInTheDocument();
  });

  it("will not decline without a reason: the error is shown, focus returns to the box and nothing is sent", async () => {
    const job = syntheticJob();
    const { served } = renderCard(job, "i1_0p");
    const bodies = answerDecision(job, "i1_0p", served);
    await userEvent.click(screen.getByRole("button", { name: "Decline fee proposal" }));
    const box = screen.getByRole("textbox", { name: "Decline the fee proposal" });
    expect(box).toHaveAttribute("placeholder", "Reason for declining (required)");
    await userEvent.click(screen.getByRole("button", { name: "Confirm decline" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a comment explaining why the fee proposal is declined.");
    expect(box).toHaveFocus();
    expect(box).toBeInvalid();
    await userEvent.type(box, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Confirm decline" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it("names the noun of the item in the error (the prototype always said quote)", async () => {
    renderCard(syntheticJob(), "i6_1a");
    await userEvent.click(screen.getByRole("button", { name: "Decline quote" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm decline" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a comment explaining why the quote is declined.");
  });

  it("declines with a reason and shows the red result with the comment in quotes", async () => {
    const job = syntheticJob();
    const { served } = renderCard(job, "i1_0p");
    const bodies = answerDecision(job, "i1_0p", served);
    await userEvent.click(screen.getByRole("button", { name: "Decline fee proposal" }));
    await userEvent.type(screen.getByRole("textbox"), "Too expensive");
    await userEvent.click(screen.getByRole("button", { name: "Confirm decline" }));
    expect(await screen.findByText("Client declined the fee proposal")).toBeInTheDocument();
    expect(screen.getByText("“Too expensive”")).toBeInTheDocument();
    expect(bodies).toEqual([{ value: "declined", comment: "Too expensive" }]);
    expect(screen.getByText("Client declined the fee proposal").closest("[data-v]")).toHaveAttribute(
      "data-v",
      "declined",
    );
  });

  it("Change re-opens the form pre-filled with the decision and its comment", async () => {
    const job = decided(syntheticJob(), "i1_0p", "declined", "Too expensive");
    renderCard(job, "i1_0p");
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("textbox", { name: "Decline the fee proposal" })).toHaveValue("Too expensive");
    expect(screen.getByRole("button", { name: "Confirm decline" })).toBeInTheDocument();
  });

  it("shows the result without Change to someone who cannot record decisions", () => {
    renderCard(decided(syntheticJob({ role: "external", grantRole: "architect" }), "i6_1a", "accepted"), "i6_1a");
    expect(screen.getByText("Client accepted the quote")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  });

  it("shows the server's reason when it refuses the decline with a 400, in the form", async () => {
    renderCard(syntheticJob(), "i1_0p");
    server.use(
      mockProblem("recordDecision", 400, PROBLEM_TYPES.validation, {
        errors: [{ path: "comment", message: "Add a comment explaining why it is declined." }],
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Decline fee proposal" }));
    await userEvent.type(screen.getByRole("textbox"), "No");
    await userEvent.click(screen.getByRole("button", { name: "Confirm decline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a comment explaining why it is declined.");
    expect(screen.queryByText(/couldn't be saved/)).not.toBeInTheDocument();
  });

  it("keeps the form open and shows the save-failed banner when the save fails", async () => {
    renderCard(syntheticJob(), "i1_0p");
    server.use(mockProblem("recordDecision", 500));
    await userEvent.click(screen.getByRole("button", { name: "Approve fee proposal" }));
    await userEvent.type(screen.getByRole("textbox"), "ok");
    await userEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(await screen.findByText(/A change couldn't be saved/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("ok");
  });
});

describe("a decision comment when the session ends (PRODUCT_SPEC 3.1, 15)", () => {
  const me = syntheticMe("external");
  const declineFlow = async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    window.sessionStorage.clear();
    const job = syntheticJob({ role: "external", grantRole: "client" });
    const view = renderCard(job, "i3_0p", { me });
    server.use(mockProblem("recordDecision", 401, PROBLEM_TYPES.unauthenticated));
    await userEvent.click(screen.getByRole("button", { name: "Decline WAPC proposal" }));
    await userEvent.type(screen.getByRole("textbox"), "Fee is too high");
    await userEvent.click(screen.getByRole("button", { name: "Confirm decline" }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledTimes(1);
    });
    view.unmount();
    return job;
  };

  it("keeps the typed comment and what it declines when Confirm decline is refused with 401", async () => {
    const job = await declineFlow();
    const key = draftKey(me.user.id, job.id, "i3_0p", "decision");
    expect(JSON.parse(window.sessionStorage.getItem(key) ?? "null")).toMatchObject({
      text: "Fee is too high",
      base: "declined",
    });
  });

  it("opens the decline form again with the comment, and says it was restored", async () => {
    const job = await declineFlow();
    renderCard(job, "i3_0p", { me });
    expect(await screen.findByRole("textbox")).toHaveValue("Fee is too high");
    expect(screen.getByRole("button", { name: "Confirm decline" })).toBeInTheDocument();
    expect(screen.getByText(MESSAGES.draftRestored)).toBeInTheDocument();
    expect(window.sessionStorage).toHaveLength(0);
  });

  it("keeps nothing when the form holds no comment, and restores only for the person who typed it", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    window.sessionStorage.clear();
    const job = syntheticJob({ role: "external", grantRole: "client" });
    const view = renderCard(job, "i3_0p", { me });
    server.use(mockProblem("recordDecision", 401, PROBLEM_TYPES.unauthenticated));
    await userEvent.click(screen.getByRole("button", { name: "Approve WAPC proposal" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalled();
    });
    expect(window.sessionStorage).toHaveLength(0);
    view.unmount();
  });
});
