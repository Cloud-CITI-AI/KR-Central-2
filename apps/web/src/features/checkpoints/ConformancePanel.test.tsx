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

  describe("after a reload while a reading is queued or running (QA r2)", () => {
    const reading = (names: string[], status: "queued" | "running" = "running") => {
      const job = withFiles(names);
      return {
        ...job,
        activeOperations: [{ id: "6f1d3b0e-5c1a-4b64-9d4e-0d8b1a2c3d4e", type: "conformance.read" as const, status }],
      };
    };

    it("says 'Reading the conformed date…', disables the read button and shows the result when it ends", async () => {
      const job = reading(["A.pdf"]);
      const starts = vi.fn();
      let polls = 0;
      renderCard(job, "i4_2");
      server.use(
        handlerFor("startConformanceReading", () => {
          starts();
          return HttpResponse.json(operation(job.id, "queued"), { status: 202 });
        }),
        handlerFor("getOperation", () => {
          polls += 1;
          return HttpResponse.json(polls < 2 ? operation(job.id, "running") : operation(job.id, "succeeded", found));
        }),
      );
      expect(screen.getByText("Reading the conformed date…")).toBeInTheDocument();
      expect(screen.getByRole("button", READ_AGAIN)).toBeDisabled();
      expect(
        await screen.findByText("Taken from the file name: Mon, 16 Mar 2026.", {}, { timeout: 4000 }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Reading the conformed date…")).not.toBeInTheDocument();
      expect(screen.getByRole("button", READ_AGAIN)).toBeEnabled();
      expect(starts).not.toHaveBeenCalled();
    });

    it("names the file generically when a resumed reading could not read the PDF", async () => {
      const job = reading(["A.pdf", "B.pdf"], "queued");
      renderCard(job, "i4_2");
      server.use(handlerFor("getOperation", () => HttpResponse.json(operation(job.id, "failed"))));
      expect(
        await screen.findByText(
          "The Conformance Notification couldn't be read. Enter the conformed date below.",
          {},
          { timeout: 4000 },
        ),
      ).toBeInTheDocument();
    });

    it("shows the server's own words when it refuses a second reading as already running", async () => {
      const job = withFiles(["A.pdf"]);
      renderCard(job, "i4_2");
      server.use(
        mockProblem("startConformanceReading", 409, PROBLEM_TYPES.conflict, {
          detail: "The conformed date is already being read. Wait for it to finish.",
        }),
      );
      await userEvent.click(screen.getByRole("button", READ_AGAIN));
      expect(
        await screen.findByText("The conformed date is already being read. Wait for it to finish."),
      ).toBeInTheDocument();
    });
  });

  describe("with scanning on (the upload answers with its file.scan operation)", () => {
    const SCAN_ID = "7a2e4c1f-6d2b-4c75-8e5f-1e9c2b3d4e5f";
    const READ_ID = "6f1d3b0e-5c1a-4b64-9d4e-0d8b1a2c3d4e";
    const NAME = "Conformance Notification 2026-07-20.pdf";
    const scanOperation = (
      jobId: string,
      status: "queued" | "succeeded" | "failed",
      followUpOperationId: string | null = READ_ID,
    ) =>
      Operation.parse({
        id: SCAN_ID,
        jobId,
        type: "file.scan",
        status,
        createdAt: AT,
        completedAt: status === "queued" ? null : AT,
        result: status === "succeeded" ? { scanStatus: "clean", followUpOperationId } : null,
        error:
          status === "failed" ? { code: "scan_error", message: "The file could not be checked for viruses." } : null,
      });
    const read = (jobId: string, status: "queued" | "running" | "succeeded", result: unknown = null) => ({
      ...operation(jobId, status, result),
      id: READ_ID,
    });
    const requestedId = (request: Request) => new URL(request.url).pathname.split("/").pop();

    async function drop(jobId: string) {
      const requests = stubUploads();
      await userEvent.upload(
        screen.getByLabelText(/Drag and drop the Conformance Notification here/),
        new File([new Uint8Array(4)], NAME, { type: "application/pdf" }),
      );
      await waitFor(() => {
        expect(requests).toHaveLength(1);
      });
      return {
        finish: (stored: ReturnType<typeof pdf>) => {
          requests[0]?.finish(201, uploadResult(stored, scanOperation(jobId, "queued")));
        },
      };
    }

    it("follows the scan and then the read it names: 'Reading the conformed date…' until the result message shows, and the job is refreshed", async () => {
      const job = syntheticJob();
      const { served } = renderCard(job, "i4_2");
      const pending = pdf(job.id, NAME, { scanStatus: "pending" });
      let scanPolls = 0;
      let readPolls = 0;
      server.use(
        handlerFor("getOperation", ({ request }) => {
          if (requestedId(request) === READ_ID) {
            readPolls += 1;
            // The panel's observer and the upload's follower may each ask once when the scan settles, so succeed on the 3rd answer.
            if (readPolls < 3) return HttpResponse.json(read(job.id, "running"));
            served.job = {
              ...withCheckpoint(job, "i4_2", { files: [{ ...pending, scanStatus: "clean" }] }),
              version: job.version + 1,
              conformedDate: "2026-07-20",
              outcomeDate: "2026-10-18",
            };
            return HttpResponse.json(read(job.id, "succeeded", { ...found, date: "2026-07-20" }));
          }
          scanPolls += 1;
          if (scanPolls < 2) return HttpResponse.json(scanOperation(job.id, "queued"));
          served.job = withCheckpoint(job, "i4_2", { files: [{ ...pending, scanStatus: "clean" }] });
          return HttpResponse.json(scanOperation(job.id, "succeeded"));
        }),
      );
      served.job = withCheckpoint(job, "i4_2", { files: [pending] });
      const upload = await drop(job.id);
      upload.finish(pending);
      expect(await screen.findByText("Reading the conformed date…")).toBeInTheDocument();
      // The scan has passed but the read is still going: the label stays and the button is off.
      await waitFor(
        () => {
          expect(readPolls).toBeGreaterThanOrEqual(1);
        },
        { timeout: 4000 },
      );
      expect(screen.getByText("Reading the conformed date…")).toBeInTheDocument();
      expect(await screen.findByRole("button", READ_AGAIN, { timeout: 4000 })).toBeDisabled();
      const result = await screen.findByText("Taken from the file name: Mon, 16 Mar 2026.", {}, { timeout: 5000 });
      expect(result.className).toMatch(/_ok_/);
      expect(screen.queryByText("Reading the conformed date…")).not.toBeInTheDocument();
      expect(screen.getByRole("button", READ_AGAIN)).toBeEnabled();
    }, 20_000);

    it("stops saying it is reading when the scan fails", async () => {
      const job = syntheticJob();
      const { served } = renderCard(job, "i4_2");
      const pending = pdf(job.id, NAME, { scanStatus: "pending" });
      server.use(
        handlerFor("getOperation", () => {
          served.job = withCheckpoint(job, "i4_2", {
            files: [{ ...pending, scanStatus: "error", scanRetriesExhausted: true }],
          });
          return HttpResponse.json(scanOperation(job.id, "failed"));
        }),
      );
      served.job = withCheckpoint(job, "i4_2", { files: [pending] });
      const upload = await drop(job.id);
      upload.finish(pending);
      await waitFor(() => {
        expect(screen.queryByText("Reading the conformed date…")).not.toBeInTheDocument();
      });
      expect(
        await screen.findByText("Couldn't be checked for viruses – remove it and upload it again"),
      ).toBeInTheDocument();
    });

    it("stops saying it is reading when the scan queued no read (an infected file)", async () => {
      const job = syntheticJob();
      const { served } = renderCard(job, "i4_2");
      const pending = pdf(job.id, NAME, { scanStatus: "pending" });
      server.use(
        handlerFor("getOperation", () => {
          served.job = withCheckpoint(job, "i4_2", { files: [{ ...pending, scanStatus: "infected" }] });
          return HttpResponse.json(scanOperation(job.id, "succeeded", null));
        }),
      );
      served.job = withCheckpoint(job, "i4_2", { files: [pending] });
      const upload = await drop(job.id);
      upload.finish(pending);
      await waitFor(() => {
        expect(screen.queryByText("Reading the conformed date…")).not.toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByRole("button", READ_AGAIN)).toBeDisabled();
      });
      expect(screen.queryByText(/Taken from the file name/)).not.toBeInTheDocument();
    });

    it("says the PDF couldn't be read when the read the scan queued fails", async () => {
      const job = syntheticJob();
      const { served } = renderCard(job, "i4_2");
      const pending = pdf(job.id, NAME, { scanStatus: "pending" });
      server.use(
        handlerFor("getOperation", ({ request }) =>
          HttpResponse.json(
            requestedId(request) === READ_ID
              ? { ...operation(job.id, "failed"), id: READ_ID }
              : scanOperation(job.id, "succeeded"),
          ),
        ),
      );
      served.job = withCheckpoint(job, "i4_2", { files: [pending] });
      const upload = await drop(job.id);
      upload.finish(pending);
      expect(
        await screen.findByText(`${NAME} couldn't be read. Enter the conformed date below.`, {}, { timeout: 5000 }),
      ).toBeInTheDocument();
    });
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
