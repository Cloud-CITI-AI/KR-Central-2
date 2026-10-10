import { Operation } from "@kr/contracts";
import { findSlot } from "@kr/workflow";
import { HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useJob } from "@/features/tracker";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { queryKeys } from "@/lib/api";
import { syntheticFile, uploadResult } from "./test-fixtures";
import { stubUploads } from "./test-upload";
import { handlerFor } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithJob, withCheckpoint } from "./test-utils";
import { useUploadFiles, type UseUploadFilesOptions } from "./useUploadFiles";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SLOT = findSlot("i7_1", "documents");
const pdf = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });

function Probe({
  jobId,
  files,
  options = { jobId, checkpointKey: "i7_1", slot: SLOT ?? { key: "", accept: [] } },
}: {
  readonly jobId: string;
  readonly files: readonly File[];
  readonly options?: UseUploadFilesOptions;
}) {
  const { upload, busy, progress, errors } = useUploadFiles(options);
  useJob(jobId); // the tracker observes the job: only active queries are refetched on invalidation
  return (
    <>
      <button
        onClick={() => {
          void upload(files);
        }}
      >
        go
      </button>
      <p data-testid="state">
        {busy ? "busy" : "idle"} {progress ? `${progress.name} ${Math.round(progress.fraction * 100)}%` : "-"}
      </p>
      <ul>
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </>
  );
}

describe("useUploadFiles", () => {
  it("sends each file in turn with the checkpoint, the slot and its own idempotency key, and shows progress", async () => {
    const job = syntheticJob();
    const requests = stubUploads();
    const { queryClient } = renderWithJob(<Probe jobId={job.id} files={[pdf("One.pdf"), pdf("Two.pdf")]} />, job);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(requests[0]?.fields).toEqual({ checkpointKey: "i7_1", slot: "documents", file: "One.pdf" });
    expect(requests[0]?.url).toBe(`/api/v1/jobs/${job.id}/files`);
    requests[0]?.progress(0.4);
    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("busy One.pdf 40%");
    });
    const first = syntheticFile(job.id, { name: "One.pdf", checkpointKey: "i7_1", slot: "documents" });
    requests[0]?.finish(201, uploadResult(first));
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    expect(
      queryClient.getQueryData<typeof job>(queryKeys.jobs.detail(job.id))?.checkpoints.find((c) => c.key === "i7_1")
        ?.files,
    ).toEqual([first]);
    requests[1]?.finish(
      201,
      uploadResult(syntheticFile(job.id, { name: "Two.pdf", checkpointKey: "i7_1", slot: "documents" })),
    );
    expect(await screen.findByText("2 files uploaded")).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("idle -");
    expect(requests[0]?.headers["idempotency-key"]).toBeTruthy();
    expect(requests[0]?.headers["idempotency-key"]).not.toBe(requests[1]?.headers["idempotency-key"]);
  });

  it("follows the file.scan operation of an upload and refreshes the job as soon as the scan settles", async () => {
    const job = syntheticJob();
    const requests = stubUploads();
    const { queryClient, served } = renderWithJob(<Probe jobId={job.id} files={[pdf("One.pdf")]} />, job);
    const pending = syntheticFile(job.id, {
      name: "One.pdf",
      checkpointKey: "i7_1",
      slot: "documents",
      scanStatus: "pending",
    });
    const scan = (status: "queued" | "succeeded") =>
      Operation.parse({
        id: "6f1d3b0e-5c1a-4b64-9d4e-0d8b1a2c3d4e",
        jobId: job.id,
        type: "file.scan",
        status,
        createdAt: "2026-09-28T03:50:56.543Z",
        completedAt: status === "succeeded" ? "2026-09-28T03:50:57.543Z" : null,
        result: null,
        error: null,
      });
    let polls = 0;
    server.use(
      handlerFor("getOperation", () => {
        polls += 1;
        if (polls < 2) return HttpResponse.json(scan("queued"));
        // The worker has finished: from now on the server holds the file as clean.
        served.job = withCheckpoint(job, "i7_1", { files: [{ ...pending, scanStatus: "clean" }] });
        return HttpResponse.json(scan("succeeded"));
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    served.job = withCheckpoint(job, "i7_1", { files: [pending] });
    requests[0]?.finish(201, uploadResult(pending, scan("queued")));
    const scanStatus = () =>
      queryClient.getQueryData<typeof job>(queryKeys.jobs.detail(job.id))?.checkpoints.find((c) => c.key === "i7_1")
        ?.files[0]?.scanStatus;
    await waitFor(() => {
      expect(scanStatus()).toBe("pending");
    });
    // Well before the 15 s periodic refetch.
    await waitFor(
      () => {
        expect(scanStatus()).toBe("clean");
      },
      { timeout: 4000 },
    );
    expect(polls).toBe(2);
  }, 10_000);

  it("lists a refused file with its reason and still stores the others", async () => {
    const job = syntheticJob();
    const requests = stubUploads();
    renderWithJob(<Probe jobId={job.id} files={[pdf("Huge.pdf"), pdf("Fine.pdf")]} />, job);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    requests[0]?.finish(413, {
      type: "urn:kr:problem:payload-too-large",
      title: "Too large",
      status: 413,
      requestId: "r1",
    });
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    requests[1]?.finish(
      201,
      uploadResult(syntheticFile(job.id, { name: "Fine.pdf", checkpointKey: "i7_1", slot: "documents" })),
    );
    expect(await screen.findByText("Huge.pdf is larger than 50 MB")).toBeInTheDocument();
    expect(await screen.findByText("1 file uploaded")).toBeInTheDocument();
  });

  it("says nothing was uploaded when every file is refused or the connection drops", async () => {
    const job = syntheticJob();
    const requests = stubUploads();
    renderWithJob(<Probe jobId={job.id} files={[pdf("Lost.pdf")]} />, job);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    requests[0]?.fail();
    expect(
      await screen.findByText("Lost.pdf couldn't be uploaded – check your connection and try again"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/uploaded$/)).not.toBeInTheDocument();
  });

  it("uploads into a condition's evidence with its id, says its kinds when refused and lets the caller place the file", async () => {
    const job = syntheticJob();
    const requests = stubUploads();
    const addFile = vi.fn((j: typeof job) => ({ ...j, address: "placed" }));
    const options: UseUploadFilesOptions = {
      jobId: job.id,
      conditionId: "5c1f6a0e-3b1d-4c8e-9a52-1d2f3a4b5c6d",
      accept: ["pdf", "image"],
      addFile,
    };
    const { queryClient } = renderWithJob(
      <Probe jobId={job.id} files={[pdf("Stat dec.pdf"), pdf("Huge.pdf")]} options={options} />,
      job,
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(requests[0]?.body?.get("conditionId")).toBe("5c1f6a0e-3b1d-4c8e-9a52-1d2f3a4b5c6d");
    expect(requests[0]?.body?.get("checkpointKey")).toBeNull();
    expect(requests[0]?.fields.file).toBe("Stat dec.pdf");
    const stored = syntheticFile(job.id, { name: "Stat dec.pdf", conditionId: "5c1f6a0e-3b1d-4c8e-9a52-1d2f3a4b5c6d" });
    requests[0]?.finish(201, uploadResult(stored));
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    expect(addFile).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }), stored);
    expect(queryClient.getQueryData<typeof job>(queryKeys.jobs.detail(job.id))?.address).toBe("placed");
    requests[1]?.finish(415, {
      type: "urn:kr:problem:unsupported-media-type",
      title: "Unsupported",
      status: 415,
      requestId: "r2",
    });
    expect(await screen.findByRole("listitem")).toHaveTextContent(/Huge.pdf.*PDF or photo/);
  });
});
