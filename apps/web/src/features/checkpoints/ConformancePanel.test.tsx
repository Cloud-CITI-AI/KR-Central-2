import { Operation, PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { syntheticFile, uploadResult } from "./test-fixtures";
import { stubUploads } from "./test-upload";
import { renderCard, withCheckpoint } from "./test-utils";

vi.mock("@/features/viewer", () => ({ useViewer: () => ({ open: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const AT = "2026-09-28T03:50:56.543Z";
const operation = (jobId: string, status: "queued" | "running" | "succeeded" | "failed", result: unknown = null) =>
  Operation.parse({
    id: "6f1d3b0e-5c1a-4b64-9d4e-0d8b1a2c3d4e",
    jobId,
    type: "conformance.read",
    status,
    createdAt: AT,
    completedAt: status === "succeeded" || status === "failed" ? AT : null,
    result,
    error: status === "failed" ? { code: "unreadable", message: "Could not read the PDF" } : null,
  });
const found = {
  found: true,
  date: "2026-03-16",
  method: "file_name",
  stampText: null,
  message: "Taken from the file name: Mon, 16 Mar 2026.",
};
const pdf = (jobId: string, name: string, overrides: Parameters<typeof syntheticFile>[1] = {}) =>
  syntheticFile(jobId, { name, checkpointKey: "i4_2", slot: "conformance", ...overrides });
const withFiles = (names: string[], options: Parameters<typeof syntheticJob>[0] = {}) => {
  const base = syntheticJob(options);
  return withCheckpoint(base, "i4_2", { files: names.map((name) => pdf(base.id, name)) });
};
const READ_AGAIN = { name: "Read conformed date again" };

describe("conformance panel", () => {
  it("shows the folder 'not received yet', the PDF zone with its hint and no read button", async () => {
    const { container } = renderCard(syntheticJob(), "i4_2");
    expect(screen.getByText("Conformance Notification")).toBeInTheDocument();
    expect(screen.getByText("not received yet")).toBeInTheDocument();
    expect(screen.getByText("Drag and drop the Conformance Notification here")).toBeInTheDocument();
    expect(
      screen.getByText("PDF – the conformed date is taken from the file name, or read from the stamp on page 1"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Drag and drop the Conformance Notification here/)).toHaveAttribute("accept", ".pdf");
    expect(screen.queryByRole("button", READ_AGAIN)).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("offers 'Read conformed date again' for one PDF and 'Read date from <file>' for several", async () => {
    const one = renderCard(withFiles(["Conformed 20260316.pdf"]), "i4_2");
    expect(screen.getByText("1 file")).toBeInTheDocument();
    expect(screen.getByRole("button", READ_AGAIN)).toBeEnabled();
    await expectNoAxeViolations(one.container);
    one.unmount();
    renderCard(withFiles(["A.pdf", "B.pdf"]), "i4_2");
    expect(screen.getByRole("button", { name: "Read date from A.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read date from B.pdf" })).toBeInTheDocument();
  });

  it("starts a read for the chosen file, says 'Reading the conformed date…' while it runs, then shows the result and refreshes the job", async () => {
    const job = withFiles(["A.pdf", "B.pdf"]);
    const second = job.checkpoints.find((c) => c.key === "i4_2")?.files[1];
    const { served } = renderCard(job, "i4_2");
    const started: unknown[] = [];
    const keys: (string | null)[] = [];
    let polls = 0;
    let jobReads = 0;
    server.use(
      handlerFor("startConformanceReading", async ({ request }) => {
        started.push(await request.json());
        keys.push(request.headers.get("idempotency-key"));
        return HttpResponse.json(operation(job.id, "queued"), { status: 202 });
      }),
      handlerFor("getOperation", () => {
        polls += 1;
        return HttpResponse.json(polls < 2 ? operation(job.id, "running") : operation(job.id, "succeeded", found));
      }),
      handlerFor("getJob", () => {
        jobReads += 1;
        return HttpResponse.json(served.job);
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Read date from B.pdf" }));
    expect(started).toEqual([{ fileId: second?.id }]);
    // The API answers 400 without an Idempotency-Key on this route (contract: required header).
    expect(keys).toEqual([expect.stringMatching(/^[\w-]{8,128}$/)]);
    expect(await screen.findByText("Reading the conformed date…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read date from A.pdf" })).toBeDisabled();
    const result = await screen.findByText("Taken from the file name: Mon, 16 Mar 2026.", {}, { timeout: 4000 });
    expect(result.className).toMatch(/_ok_/);
    expect(screen.queryByText("Reading the conformed date…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read date from A.pdf" })).toBeEnabled();
    await waitFor(() => {
      expect(jobReads).toBeGreaterThan(0);
    });
  });

  it("starts following the read that an upload started", async () => {
    const job = syntheticJob();
    const requests = stubUploads();
    const { served } = renderCard(job, "i4_2");
    server.use(handlerFor("getOperation", () => HttpResponse.json(operation(job.id, "succeeded", found))));
    await userEvent.upload(
      screen.getByLabelText(/Drag and drop the Conformance Notification here/),
      new File([new Uint8Array(4)], "Conformed 20260316.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(requests[0]?.fields).toEqual({ checkpointKey: "i4_2", slot: "conformance", file: "Conformed 20260316.pdf" });
    const stored = pdf(job.id, "Conformed 20260316.pdf");
    served.job = withCheckpoint(job, "i4_2", { files: [stored] });
    requests[0]?.finish(201, uploadResult(stored, operation(job.id, "queued")));
    expect(
      await screen.findByText("Taken from the file name: Mon, 16 Mar 2026.", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 file")).toBeInTheDocument();
  });

  it("shows a read that found nothing as a problem to act on", async () => {
    const job = withFiles(["Notice.pdf"]);
    renderCard(job, "i4_2");
    const message = "No stamped date could be found on page 1 of Notice.pdf. Enter the conformed date below.";
    server.use(
      handlerFor("startConformanceReading", () => HttpResponse.json(operation(job.id, "queued"), { status: 202 })),
      handlerFor("getOperation", () =>
        HttpResponse.json(
          operation(job.id, "succeeded", { found: false, date: null, method: null, stampText: null, message }),
        ),
      ),
    );
    await userEvent.click(screen.getByRole("button", READ_AGAIN));
    const text = await screen.findByText(message, {}, { timeout: 4000 });
    expect(text).toBeInTheDocument();
    expect(text.className).not.toMatch(/_ok_/);
  });

  it("says the PDF couldn't be read when the operation fails", async () => {
    const job = withFiles(["Notice.pdf"]);
    renderCard(job, "i4_2");
    server.use(
      handlerFor("startConformanceReading", () => HttpResponse.json(operation(job.id, "queued"), { status: 202 })),
      handlerFor("getOperation", () => HttpResponse.json(operation(job.id, "failed"))),
    );
    await userEvent.click(screen.getByRole("button", READ_AGAIN));
    expect(
      await screen.findByText("Notice.pdf couldn't be read. Enter the conformed date below.", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it("explains a 409 (file not ready) and a failed request, and lets the person try again", async () => {
    renderCard(withFiles(["Notice.pdf"]), "i4_2");
    server.use(mockProblem("startConformanceReading", 409, PROBLEM_TYPES.conflict));
    await userEvent.click(screen.getByRole("button", READ_AGAIN));
    expect(
      await screen.findByText("Notice.pdf isn't ready to be read yet – try again once it has been checked for viruses"),
    ).toBeInTheDocument();
    server.use(mockProblem("startConformanceReading", 500));
    await userEvent.click(screen.getByRole("button", READ_AGAIN));
    expect(await screen.findByText(/Notice\.pdf couldn't be sent to be read \(Request ID: .+\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", READ_AGAIN)).toBeEnabled();
  });

  it("sends a fresh Idempotency-Key with each read request (the API answers 400 without one)", async () => {
    const job = withFiles(["Notice.pdf"]);
    renderCard(job, "i4_2");
    const keys: (string | null)[] = [];
    server.use(
      handlerFor("startConformanceReading", ({ request }) => {
        keys.push(request.headers.get("idempotency-key"));
        return HttpResponse.json(operation(job.id, "queued"), { status: 202 });
      }),
      handlerFor("getOperation", () => HttpResponse.json(operation(job.id, "succeeded", found))),
    );
    await userEvent.click(screen.getByRole("button", READ_AGAIN));
    await screen.findByText("Taken from the file name: Mon, 16 Mar 2026.", {}, { timeout: 4000 });
    await userEvent.click(screen.getByRole("button", READ_AGAIN));
    await waitFor(() => {
      expect(keys).toHaveLength(2);
    });
    for (const key of keys) expect(key).toMatch(/^[\x21-\x7e]{8,128}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("offers the read for a file that scanning skipped (MALWARE_SCAN_MODE=disabled), as extraction does", () => {
    const base = syntheticJob();
    renderCard(
      withCheckpoint(base, "i4_2", { files: [pdf(base.id, "Skipped.pdf", { scanStatus: "skipped" })] }),
      "i4_2",
    );
    expect(screen.getByRole("button", READ_AGAIN)).toBeEnabled();
  });

  it.each(["pending", "infected", "error"] as const)("keeps the read button off for a %s file", (scanStatus) => {
    const base = syntheticJob();
    renderCard(withCheckpoint(base, "i4_2", { files: [pdf(base.id, "Bad.pdf", { scanStatus })] }), "i4_2");
    expect(screen.getByRole("button", READ_AGAIN)).toBeDisabled();
  });

  it("keeps the read button off until the file has been scanned", () => {
    const base = syntheticJob();
    renderCard(withCheckpoint(base, "i4_2", { files: [pdf(base.id, "Fresh.pdf", { scanStatus: "pending" })] }), "i4_2");
    expect(screen.getByText("Scanning…")).toBeInTheDocument();
    expect(screen.getByRole("button", READ_AGAIN)).toBeDisabled();
  });

  it("shows an architect the files only: no zone and no read button", () => {
    renderCard(withFiles(["Notice.pdf"], { role: "external", grantRole: "architect" }), "i4_2");
    expect(screen.getByRole("button", { name: "Notice.pdf" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Drag and drop the Conformance Notification here/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", READ_AGAIN)).not.toBeInTheDocument();
  });
});
