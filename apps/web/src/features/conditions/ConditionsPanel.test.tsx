import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticFile } from "@/features/checkpoints/test-fixtures";
import { renderCard, withCheckpoint } from "@/features/checkpoints/test-utils";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { extractionOperation, extractionResult, syntheticConditionJob } from "./test-fixtures";

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
const EXTRACT = { name: "Extract conditions from Decision Letter" };
const RE_EXTRACT = { name: "Re-extract conditions from Decision Letter" };

describe("conditions panel: the folder and the extraction", () => {
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

  it("says the letter needs 'Decision Letter' in its name when PDFs exist but none is named so", async () => {
    const { container } = renderCard(withFiles(["Stamped plan.pdf"]), "i5_0");
    expect(
      screen.getByText(
        'Conditions can only be extracted from the Decision Letter – upload it with "Decision Letter" in the file name.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Extract/ })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("offers one extract button for a PDF named 'decision' in any case", async () => {
    const { container } = renderCard(withFiles(["Plan.pdf", "WAPC DECISION letter.pdf"]), "i5_0");
    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getByRole("button", EXTRACT)).toBeEnabled();
    expect(screen.getAllByRole("button", { name: /Extract/ })).toHaveLength(1);
    await expectNoAxeViolations(container);
  });

  it("names the file on each button when there are several Decision Letters", () => {
    renderCard(withFiles(["Decision Letter.pdf", "Decision Letter v2.pdf"]), "i5_0");
    expect(screen.getByRole("button", { name: "Extract conditions – Decision Letter.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extract conditions – Decision Letter v2.pdf" })).toBeInTheDocument();
  });

  it("keeps the button disabled until the Decision Letter has been scanned", () => {
    const base = syntheticConditionJob();
    renderCard(
      withCheckpoint(base, "i5_0", { files: [file(base.id, "Decision Letter.pdf", { scanStatus: "pending" })] }),
      "i5_0",
    );
    expect(screen.getByRole("button", EXTRACT)).toBeDisabled();
  });

  it("starts the extraction with an Idempotency-Key, shows progress, then the count and the guessed-agency note", async () => {
    const job = withFiles(["Decision Letter.pdf"]);
    const letter = job.checkpoints.find((c) => c.key === "i5_0")?.files[0];
    const { served } = renderCard(job, "i5_0");
    const started: { body: unknown; key: string | null }[] = [];
    let polls = 0;
    let jobReads = 0;
    const guessed = "Check the agency for conditions 3, 7 – no agency was named in brackets, so it was guessed.";
    server.use(
      handlerFor("startConditionsExtraction", async ({ request }) => {
        started.push({ body: await request.json(), key: request.headers.get("idempotency-key") });
        return HttpResponse.json(extractionOperation(job.id, "queued"), { status: 202 });
      }),
      handlerFor("getOperation", () => {
        polls += 1;
        return HttpResponse.json(
          polls < 2
            ? extractionOperation(job.id, "running")
            : extractionOperation(job.id, "succeeded", extractionResult(13, guessed)),
        );
      }),
      handlerFor("getJob", () => {
        jobReads += 1;
        return HttpResponse.json(served.job);
      }),
    );
    await userEvent.click(screen.getByRole("button", EXTRACT));
    expect(started).toHaveLength(1);
    expect(started[0]?.body).toEqual({ fileId: letter?.id, replaceExisting: false });
    expect(started[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    const busy = await screen.findByRole("button", { name: "Reading Decision Letter…" });
    expect(busy).toBeDisabled();
    expect(await screen.findByText("13 conditions extracted", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(guessed)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reading Decision Letter…" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(jobReads).toBeGreaterThan(0);
    });
  });

  it("says when no numbered conditions were found", async () => {
    const job = withFiles(["Decision Letter.pdf"]);
    renderCard(job, "i5_0");
    const message =
      "No numbered conditions were found in this PDF. Check it is the WAPC conditional approval letter (not a scanned image).";
    server.use(
      handlerFor("startConditionsExtraction", () =>
        HttpResponse.json(extractionOperation(job.id, "queued"), { status: 202 }),
      ),
      handlerFor("getOperation", () =>
        HttpResponse.json(extractionOperation(job.id, "succeeded", extractionResult(0, message))),
      ),
    );
    await userEvent.click(screen.getByRole("button", EXTRACT));
    expect(await screen.findByText(message, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/conditions? extracted/)).not.toBeInTheDocument();
  });

  it("says the PDF could not be read when the extraction fails", async () => {
    const job = withFiles(["Decision Letter.pdf"]);
    renderCard(job, "i5_0");
    server.use(
      handlerFor("startConditionsExtraction", () =>
        HttpResponse.json(extractionOperation(job.id, "queued"), { status: 202 }),
      ),
      handlerFor("getOperation", () => HttpResponse.json(extractionOperation(job.id, "failed"))),
    );
    await userEvent.click(screen.getByRole("button", EXTRACT));
    expect(
      await screen.findByText(
        "This PDF couldn't be read. Try re-saving it as a PDF and uploading again.",
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", EXTRACT)).toBeEnabled();
  });

  it.each([
    ["timeout", "Reading the document took too long. Try again."],
    ["file_unavailable", "The Decision Letter is no longer available. Upload it again."],
  ])("shows the message of a %s failure instead of the unreadable-PDF advice", async (code, message) => {
    const job = withFiles(["Decision Letter.pdf"]);
    renderCard(job, "i5_0");
    server.use(
      handlerFor("startConditionsExtraction", () =>
        HttpResponse.json(extractionOperation(job.id, "queued"), { status: 202 }),
      ),
      handlerFor("getOperation", () =>
        HttpResponse.json(extractionOperation(job.id, "failed", null, { code, message })),
      ),
    );
    await userEvent.click(screen.getByRole("button", EXTRACT));
    expect(await screen.findByText(message, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/couldn't be read/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", EXTRACT)).toBeEnabled();
  });

  it("shows the reason of a 409 that is not about replacing, and a request id for any other failure", async () => {
    const job = withFiles(["Decision Letter.pdf"]);
    renderCard(job, "i5_0");
    server.use(
      mockProblem("startConditionsExtraction", 409, PROBLEM_TYPES.fileNotReady, {
        detail: "Decision Letter.pdf is still being checked for viruses. Try again in a moment.",
      }),
    );
    await userEvent.click(screen.getByRole("button", EXTRACT));
    expect(
      await screen.findByText("Decision Letter.pdf is still being checked for viruses. Try again in a moment."),
    ).toBeInTheDocument();
    server.use(mockProblem("startConditionsExtraction", 500));
    await userEvent.click(screen.getByRole("button", EXTRACT));
    expect(
      await screen.findByText("Conditions couldn't be extracted from Decision Letter.pdf (Request ID: req-test-0001)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/still being checked/)).not.toBeInTheDocument();
  });

  it("asks before replacing existing conditions: Cancel sends nothing, Replace sends replaceExisting", async () => {
    const job = withFiles(["Decision Letter.pdf"], { agencies: ["WAPC", "Western Power"] });
    const letter = job.checkpoints.find((c) => c.key === "i5_0")?.files[0];
    renderCard(job, "i5_0");
    const bodies: unknown[] = [];
    const keys: (string | null)[] = [];
    server.use(
      handlerFor("startConditionsExtraction", async ({ request }) => {
        bodies.push(await request.json());
        keys.push(request.headers.get("idempotency-key"));
        return HttpResponse.json(extractionOperation(job.id, "queued"), { status: 202 });
      }),
      handlerFor("getOperation", () => HttpResponse.json(extractionOperation(job.id, "running"))),
    );
    await userEvent.click(screen.getByRole("button", RE_EXTRACT));
    expect(
      screen.getByText("Replace the 2 existing conditions, including their ticks, comments and evidence?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", RE_EXTRACT)).toHaveFocus();
    expect(bodies).toEqual([]);

    await userEvent.click(screen.getByRole("button", RE_EXTRACT));
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => {
      expect(bodies).toEqual([{ fileId: letter?.id, replaceExisting: true }]);
    });
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole("button", { name: "Reading Decision Letter…" })).toBeDisabled();
  });

  it("asks after a 409 when conditions appeared that this page did not know about, then retries with a new key", async () => {
    const job = withFiles(["Decision Letter.pdf"]);
    renderCard(job, "i5_0");
    const sent: { body: { replaceExisting: boolean }; key: string | null }[] = [];
    server.use(
      handlerFor("startConditionsExtraction", async ({ request }) => {
        const body = (await request.json()) as { replaceExisting: boolean };
        sent.push({ body, key: request.headers.get("idempotency-key") });
        if (!body.replaceExisting) {
          return HttpResponse.json(
            {
              type: PROBLEM_TYPES.conflict,
              title: "Conflict",
              status: 409,
              detail: "Replace the 13 existing conditions, including their ticks, comments and evidence?",
              requestId: "req-test-0001",
            },
            { status: 409, headers: { "content-type": "application/problem+json" } },
          );
        }
        return HttpResponse.json(extractionOperation(job.id, "queued"), { status: 202 });
      }),
      handlerFor("getOperation", () => HttpResponse.json(extractionOperation(job.id, "running"))),
    );
    await userEvent.click(screen.getByRole("button", EXTRACT));
    expect(
      await screen.findByText("Replace the 13 existing conditions, including their ticks, comments and evidence?"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(sent.map((s) => s.body.replaceExisting)).toEqual([false, true]);
    expect(sent[0]?.key).not.toBe(sent[1]?.key);
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
