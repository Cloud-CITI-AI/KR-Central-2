import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftKey, queryKeys } from "@/lib/api";
import { navigation } from "@/lib/navigation";
import { MESSAGES } from "@/lib/messages";
import { syntheticMe } from "@/test/fixtures";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { checkpointOf, renderCard, withCheckpoint } from "./test-utils";

const LABEL = "KR Surveys comment – what the client needs to pay";
const PLACEHOLDER = "e.g. Development contribution of $X payable to the Shire – invoice attached";

interface Seen {
  readonly ifMatch: string | null;
  readonly body: unknown;
}

/** Answer `updateCheckpoint` as the API does: store the note and bump the version. */
function recordSaves(job: ReturnType<typeof syntheticJob>, served: { job: ReturnType<typeof syntheticJob> }) {
  const seen: Seen[] = [];
  server.use(
    handlerFor("updateCheckpoint", async ({ request }) => {
      const body = (await request.json()) as { krNote?: string };
      seen.push({ ifMatch: request.headers.get("if-match"), body });
      const before = checkpointOf(served.job, "i8_3");
      served.job = withCheckpoint(job, "i8_3", { krNote: body.krNote ?? "", version: before.version + 1 });
      return HttpResponse.json(checkpointOf(served.job, "i8_3"));
    }),
  );
  return seen;
}

describe("KR note panel", () => {
  it("shows the labelled textarea with the placeholder from the definition and the saved text", async () => {
    const job = withCheckpoint(syntheticJob(), "i8_3", { krNote: "Pay the Shire $500" });
    const { container } = renderCard(job, "i8_3");
    const field = screen.getByLabelText(LABEL);
    expect(field).toHaveValue("Pay the Shire $500");
    expect(field).toHaveAttribute("placeholder", PLACEHOLDER);
    expect(field).not.toHaveAttribute("readonly");
    await expectNoAxeViolations(container);
  });

  it("saves 700 ms after typing stops, once, with If-Match on the checkpoint version", async () => {
    const job = syntheticJob();
    const { served } = renderCard(job, "i8_3");
    const seen = recordSaves(job, served);
    await userEvent.type(screen.getByLabelText(LABEL), "Pay the Shire");
    expect(seen).toEqual([]);
    await waitFor(
      () => {
        expect(seen).toEqual([{ ifMatch: '"1"', body: { krNote: "Pay the Shire" } }]);
      },
      { timeout: 3000 },
    );
    expect(screen.getByLabelText(LABEL)).toHaveValue("Pay the Shire");
  });

  it("saves a note typed over someone else's refreshed note against the version it was typed over (§14, §15)", async () => {
    const job = syntheticJob();
    const { served, queryClient } = renderCard(job, "i8_3");
    const seen = recordSaves(job, served);
    await userEvent.type(screen.getByLabelText(LABEL), "abc");
    await waitFor(
      () => {
        expect(seen).toHaveLength(1);
      },
      { timeout: 3000 },
    );
    served.job = withCheckpoint(job, "i8_3", { krNote: "Sam's note", version: 3 });
    await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.detail(job.id) });
    expect(screen.getByLabelText(LABEL)).toHaveValue("abc");
    await userEvent.type(screen.getByLabelText(LABEL), "def");
    await userEvent.tab();
    await waitFor(() => {
      expect(seen).toHaveLength(2);
    });
    expect(seen[1]).toEqual({ ifMatch: '"2"', body: { krNote: "abcdef" } });
  });

  it("saves on blur at once, trimmed, and not again when nothing changed", async () => {
    const job = syntheticJob();
    const { served } = renderCard(job, "i8_3");
    const seen = recordSaves(job, served);
    const field = screen.getByLabelText(LABEL);
    await userEvent.type(field, "  See invoice  ");
    await userEvent.tab();
    await waitFor(() => {
      expect(seen).toEqual([{ ifMatch: '"1"', body: { krNote: "See invoice" } }]);
    });
    expect(field).toHaveValue("See invoice");
    await userEvent.click(field);
    await userEvent.tab();
    expect(seen).toHaveLength(1);
  });

  it("is read-only for a client, who reads it to see what to pay, and for an architect", () => {
    const job = withCheckpoint(syntheticJob({ role: "external", grantRole: "client" }), "i8_3", {
      krNote: "Pay the Shire $500",
    });
    const client = renderCard(job, "i8_3");
    expect(screen.getByLabelText(LABEL)).toHaveValue("Pay the Shire $500");
    expect(screen.getByLabelText(LABEL)).toHaveAttribute("readonly");
    client.unmount();
    renderCard(syntheticJob({ role: "external", grantRole: "architect" }), "i8_3");
    expect(screen.getByLabelText(LABEL)).toHaveAttribute("readonly");
  });

  it("shows the save-failed banner and, once the person leaves the field, the saved text again", async () => {
    renderCard(syntheticJob(), "i8_3");
    server.use(mockProblem("updateCheckpoint", 500));
    const field = screen.getByLabelText(LABEL);
    await userEvent.type(field, "Lost");
    await userEvent.tab();
    expect(await screen.findByText(/A change couldn't be saved/)).toBeInTheDocument();
    await waitFor(() => {
      expect(field).toHaveValue("");
    });
  });

  it("never replaces what is being typed when the job refreshes, and shows the new text once the person leaves", async () => {
    const job = syntheticJob();
    const { queryClient } = renderCard(job, "i8_3");
    server.use(mockProblem("updateCheckpoint", 500));
    const field = screen.getByLabelText(LABEL);
    await userEvent.type(field, "Mine");
    act(() => {
      queryClient.setQueryData(queryKeys.jobs.detail(job.id), withCheckpoint(job, "i8_3", { krNote: "Theirs" }));
    });
    expect(field).toHaveValue("Mine");
  });
});

describe("KR note panel when the session ends", () => {
  const SAVED = "Synthetic partial comment";
  const TYPED_AFTER = " plus more typed after expiry…";
  const me = syntheticMe("staff");
  const expired = () => mockProblem("updateCheckpoint", 401, "urn:kr:problem:unauthenticated");

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  /**
   * The repro: type, let it save (the field keeps focus), then the session ends and typing goes on: the autosave answers
   * 401 and the app goes to sign-in. Returns the job as the server holds it afterwards.
   */
  async function typeUntilSignedOut() {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    const start = syntheticJob();
    const view = renderCard(start, "i8_3", { me });
    const { served } = view;
    const seen = recordSaves(start, served);
    const field = screen.getByLabelText(LABEL);
    await userEvent.type(field, SAVED);
    await waitFor(() => {
      expect(seen).toEqual([{ ifMatch: '"1"', body: { krNote: SAVED } }]);
    });
    server.use(expired());
    await userEvent.type(field, TYPED_AFTER);
    await waitFor(() => {
      expect(assign).toHaveBeenCalledTimes(1);
    });
    view.unmount();
    return served.job;
  }

  it("keeps the typed text in session storage when a 401 sends the person to sign-in", async () => {
    const job = await typeUntilSignedOut();
    expect(window.sessionStorage).toHaveLength(1);
    const key = window.sessionStorage.key(0) ?? "";
    expect(key).toBe(draftKey(me.user.id, job.id, "i8_3", "krNote"));
    expect(JSON.parse(window.sessionStorage.getItem(key) ?? "null")).toMatchObject({
      text: SAVED + TYPED_AFTER,
      base: SAVED,
    });
  });

  it("puts the text back after sign-in and saves it, when the saved text is still the one it was typed over", async () => {
    const job = await typeUntilSignedOut();
    const { served } = renderCard(job, "i8_3", { me });
    const seen = recordSaves(job, served);
    expect(screen.getByLabelText(LABEL)).toHaveValue(SAVED + TYPED_AFTER);
    expect(screen.getByText(MESSAGES.draftRestored)).toBeInTheDocument();
    await waitFor(() => {
      expect(seen).toEqual([{ ifMatch: '"2"', body: { krNote: SAVED + TYPED_AFTER } }]);
    });
    expect(window.sessionStorage.length).toBe(0);
    expect(screen.getByLabelText(LABEL)).toHaveValue(SAVED + TYPED_AFTER);
  });

  it("puts the text back but does not save it when someone else changed the note meanwhile", async () => {
    const job = await typeUntilSignedOut();
    const changed = withCheckpoint(job, "i8_3", { krNote: "Theirs", version: 3 });
    const { served } = renderCard(changed, "i8_3", { me });
    const seen = recordSaves(changed, served);
    expect(screen.getByLabelText(LABEL)).toHaveValue(SAVED + TYPED_AFTER);
    expect(screen.getByText(MESSAGES.draftRestoredChanged)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(seen).toEqual([]);
    expect(screen.getByLabelText(LABEL)).toHaveValue(SAVED + TYPED_AFTER);
  });

  it("does not restore another person's draft, or into a field the person can no longer edit", async () => {
    const job = await typeUntilSignedOut();
    const other = renderCard(job, "i8_3", { me: syntheticMe("staff") });
    expect(screen.getByLabelText(LABEL)).toHaveValue(SAVED);
    other.unmount();
    const readOnly = withCheckpoint(syntheticJob({ role: "external", grantRole: "client" }), "i8_3", { krNote: SAVED });
    renderCard({ ...readOnly, id: job.id }, "i8_3", { me });
    expect(screen.getByLabelText(LABEL)).toHaveValue(SAVED);
    expect(window.sessionStorage.length).toBe(1);
  });

  it("keeps nothing for a field the person only focused and left alone, or that is saved", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    const job = syntheticJob();
    const { queryClient } = renderCard(job, "i8_3", { me });
    await userEvent.click(screen.getByLabelText(LABEL));
    await userEvent.tab();
    server.use(mockProblem("getJob", 401, "urn:kr:problem:unauthenticated"));
    await queryClient.refetchQueries({ queryKey: queryKeys.jobs.detail(job.id) });
    expect(assign).toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });
});
