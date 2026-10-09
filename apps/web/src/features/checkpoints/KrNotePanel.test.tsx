import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/api";
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
