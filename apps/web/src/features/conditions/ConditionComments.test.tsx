import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderCard } from "@/features/checkpoints/test-utils";
import { draftKey, queryKeys } from "@/lib/api";
import { navigation } from "@/lib/navigation";
import { syntheticMe } from "@/test/fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { MESSAGES } from "@/lib/messages";
import { mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { checklistCard as group, serveUpdates, threeConditions } from "./test-utils";
import { conditionAt, withCondition } from "./test-fixtures";

vi.mock("@/features/viewer", () => ({ useViewer: () => ({ open: vi.fn() }) }));

const kr = (number: number) =>
  within(group(number)).getByRole("textbox", { name: `KR Surveys comment – condition ${number}` });
const client = (number: number) =>
  within(group(number)).getByRole("textbox", { name: `Client comment – condition ${number}` });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("condition comments", () => {
  it("shows both comments side by side with their labels", async () => {
    const base = threeConditions();
    const job = withCondition(base, conditionAt(base, 0).id, {
      krComment: "Stat dec needed",
      clientComment: "Sent on Monday",
    });
    const { container } = renderCard(job, "i5_0");
    expect(kr(1)).toHaveValue("Stat dec needed");
    expect(client(1)).toHaveValue("Sent on Monday");
    expect(kr(2)).toHaveValue("");
    expect(within(group(1)).getByText("KR Surveys comment")).toBeInTheDocument();
    expect(within(group(1)).getByText("Client comment")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("saves the KR comment 700 ms after typing stops, not before", async () => {
    const job = threeConditions();
    const { served } = renderCard(job, "i5_0");
    const calls = serveUpdates(served);
    await userEvent.type(kr(1), "Needs a stat dec");
    await pause(300);
    expect(calls).toHaveLength(0);
    await waitFor(
      () => {
        expect(calls).toHaveLength(1);
      },
      { timeout: 3000 },
    );
    expect(calls[0]).toMatchObject({
      conditionId: conditionAt(job, 0).id,
      body: { krComment: "Needs a stat dec" },
      ifMatch: '"1"',
    });
    expect(kr(1)).toHaveValue("Needs a stat dec");
  });

  it("saves on blur at once, with the text trimmed", async () => {
    const job = threeConditions();
    const { served } = renderCard(job, "i5_0");
    const calls = serveUpdates(served);
    await userEvent.type(client(2), "  Approved by the shire  ");
    await userEvent.tab();
    await waitFor(
      () => {
        expect(calls).toHaveLength(1);
      },
      { timeout: 500 },
    );
    expect(calls[0]?.body).toEqual({ clientComment: "Approved by the shire" });
    expect(client(2)).toHaveValue("Approved by the shire");
  });

  it("does not save a comment that did not change", async () => {
    const job = threeConditions();
    const { served } = renderCard(job, "i5_0");
    const calls = serveUpdates(served);
    await userEvent.click(kr(1));
    await userEvent.tab();
    await pause(100);
    expect(calls).toHaveLength(0);
  });

  it("never replaces the text under the cursor when the job refreshes, and takes the new text afterwards", async () => {
    const job = threeConditions();
    const { served, queryClient } = renderCard(job, "i5_0");
    await userEvent.type(kr(1), "typing");
    served.job = withCondition(job, conditionAt(job, 0).id, { krComment: "Written by someone else", version: 2 });
    await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.detail(job.id) });
    expect(kr(1)).toHaveValue("typing");
    expect(kr(2)).toHaveValue("");
    server.use(mockProblem("updateCondition", 500));
    await userEvent.tab();
    await waitFor(() => {
      expect(kr(1)).toHaveValue("Written by someone else");
    });
  });

  it("shows the saved text again, with the save-failed banner, when a comment could not be saved", async () => {
    const job = threeConditions();
    renderCard(job, "i5_0");
    server.use(mockProblem("updateCondition", 500));
    await userEvent.type(client(1), "lost");
    await userEvent.tab();
    expect(await screen.findByText(/A change couldn't be saved\./)).toBeInTheDocument();
    await waitFor(() => {
      expect(client(1)).toHaveValue("");
    });
  });

  it("reloads and says so when the condition changed meanwhile (412)", async () => {
    const job = threeConditions();
    const { served } = renderCard(job, "i5_0");
    served.job = withCondition(job, conditionAt(job, 0).id, { clientComment: "Theirs", version: 4 });
    server.use(mockProblem("updateCondition", 412, PROBLEM_TYPES.preconditionFailed));
    await userEvent.type(kr(1), "Mine");
    await userEvent.tab();
    expect(
      await screen.findByText("Someone else changed this — the latest version has been loaded."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(client(1)).toHaveValue("Theirs");
    });
  });
});

describe("who may change what on a condition (§2.1)", () => {
  it("lets staff change everything", () => {
    renderCard(threeConditions({ role: "staff" }), "i5_0");
    expect(within(group(1)).getByRole("checkbox")).toBeEnabled();
    expect(within(group(1)).getByRole("combobox", { name: "Agency for condition 1" })).toBeEnabled();
    expect(within(group(1)).getByRole("combobox", { name: "Responsibility for condition 1" })).toBeEnabled();
    expect(kr(1)).not.toHaveAttribute("readonly");
    expect(client(1)).not.toHaveAttribute("readonly");
  });

  it.each(["client", "architect"] as const)("lets a %s change only the client comment", async (grantRole) => {
    const job = threeConditions({ role: "external", grantRole });
    const { container, served } = renderCard(job, "i5_0");
    const calls = serveUpdates(served);
    expect(within(group(1)).getByRole("checkbox")).toBeDisabled();
    expect(within(group(1)).getByRole("combobox", { name: "Responsibility for condition 1" })).toBeDisabled();
    expect(within(group(1)).queryByRole("combobox", { name: "Agency for condition 1" })).not.toBeInTheDocument();
    expect(within(group(1)).getByText("Western Power")).toBeInTheDocument();
    expect(within(group(3)).queryByRole("button", { name: "Agency is correct" })).not.toBeInTheDocument();
    expect(within(group(3)).getByText("Agency guessed – please check")).toBeInTheDocument();
    expect(kr(1)).toHaveAttribute("readonly");
    expect(client(1)).not.toHaveAttribute("readonly");
    await userEvent.type(client(1), "Thanks");
    await userEvent.tab();
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toEqual({ clientComment: "Thanks" });
    await expectNoAxeViolations(container);
  });

  it("keeps the client comment on screen when the save is refused as stale, beside the KR comment someone else saved", async () => {
    const job = threeConditions();
    const { served } = renderCard(job, "i5_0");
    const target = conditionAt(job, 0);
    served.job = withCondition(job, target.id, { krComment: "KR: power design lodged", version: 2 });
    server.use(mockProblem("updateCondition", 412, PROBLEM_TYPES.preconditionFailed));
    await userEvent.type(client(1), "Client: thanks, will pay");
    await userEvent.tab();
    expect(await screen.findByText(MESSAGES.stale)).toBeInTheDocument();
    await waitFor(() => {
      expect(kr(1)).toHaveValue("KR: power design lodged");
    });
    expect(client(1)).toHaveValue("Client: thanks, will pay");
  });
});

describe("condition comments when the session ends", () => {
  const me = syntheticMe("staff");
  const SAVED = "Stat dec needed";
  const TYPED = " – and a plan of the easement, typed after expiry";

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  async function typeUntilSignedOut(field: (number: number) => HTMLElement, name: "krComment" | "clientComment") {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    const base = threeConditions();
    const job = withCondition(base, conditionAt(base, 0).id, { [name]: SAVED });
    const view = renderCard(job, "i5_0", { me });
    server.use(mockProblem("updateCondition", 401, PROBLEM_TYPES.unauthenticated));
    await userEvent.type(field(1), TYPED);
    await waitFor(() => {
      expect(assign).toHaveBeenCalledTimes(1);
    });
    view.unmount();
    return job;
  }

  it.each([
    ["KR Surveys comment", kr, "krComment"],
    ["client comment", client, "clientComment"],
  ] as const)("keeps the %s typed after expiry and saves it again after sign-in", async (_label, field, name) => {
    const job = await typeUntilSignedOut(field, name);
    const stored = window.sessionStorage.getItem(draftKey(me.user.id, "condition", conditionAt(job, 0).id, name));
    expect(JSON.parse(stored ?? "null")).toMatchObject({ text: SAVED + TYPED, base: SAVED });

    const { served } = renderCard(job, "i5_0", { me });
    const calls = serveUpdates(served);
    expect(field(1)).toHaveValue(SAVED + TYPED);
    expect(screen.getByText(MESSAGES.draftRestored)).toBeInTheDocument();
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toMatchObject({ conditionId: conditionAt(job, 0).id, body: { [name]: SAVED + TYPED } });
    expect(window.sessionStorage.length).toBe(0);
  });

  it("does not put the draft into the session of someone else who signs in on the same tab", async () => {
    const job = await typeUntilSignedOut(kr, "krComment");
    const { served } = renderCard(job, "i5_0", { me: syntheticMe("staff") });
    const calls = serveUpdates(served);
    expect(kr(1)).toHaveValue(SAVED);
    await pause(900);
    expect(calls).toHaveLength(0);
  });
});
