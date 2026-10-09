import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { PROBLEM_TYPES, type FileMeta, type JobDetail } from "@kr/contracts";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { queryKeys } from "@/lib/api";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { syntheticFile } from "./test-fixtures";
import { renderWithJob } from "./test-utils";
import { useDeleteFile, type FileListEdit } from "./useDeleteFile";

function Probe({
  jobId,
  file,
  from,
}: {
  readonly jobId: string;
  readonly file: FileMeta;
  readonly from: FileListEdit;
}) {
  const { remove, removing } = useDeleteFile(jobId, from);
  return (
    <button
      onClick={() => {
        void remove(file);
      }}
    >
      {removing.has(file.id) ? "removing" : "remove"}
    </button>
  );
}

function setup() {
  const job = syntheticJob();
  const file = syntheticFile(job.id, { name: "Stat dec.pdf" });
  const from: FileListEdit = {
    without: vi.fn((j: JobDetail) => ({ ...j, address: "without" })),
    restore: vi.fn((j: JobDetail) => ({ ...j, address: "restored" })),
  };
  const rendered = renderWithJob(<Probe jobId={job.id} file={file} from={from} />, job);
  const title = () => rendered.queryClient.getQueryData<JobDetail>(queryKeys.jobs.detail(job.id))?.address;
  return { job, file, from, title, ...rendered };
}

describe("useDeleteFile with another list of files", () => {
  it("lets the caller take the file out of the cached job and refreshes afterwards", async () => {
    const { file, from, title } = setup();
    server.use(handlerFor("deleteFile", () => new HttpResponse(null, { status: 204 })));
    await userEvent.click(screen.getByRole("button", { name: "remove" }));
    expect(from.without).toHaveBeenCalledWith(expect.anything(), file);
    await waitFor(() => {
      expect(screen.getByRole("button")).toHaveTextContent("remove");
    });
    expect(from.restore).not.toHaveBeenCalled();
    expect(title()).not.toBe("restored");
  });

  it("puts the file back through the caller and shows the save-failed banner when removal fails", async () => {
    const { file, from, title } = setup();
    server.use(mockProblem("deleteFile", 500));
    await userEvent.click(screen.getByRole("button", { name: "remove" }));
    expect(await screen.findByText(/A change couldn't be saved/)).toBeInTheDocument();
    expect(from.restore).toHaveBeenCalledWith(expect.anything(), file);
    expect(title()).toBe("restored");
  });

  it("leaves the file out when someone else already removed it", async () => {
    const { from } = setup();
    server.use(mockProblem("deleteFile", 404, PROBLEM_TYPES.notFound));
    await userEvent.click(screen.getByRole("button", { name: "remove" }));
    await waitFor(() => {
      expect(screen.getByRole("button")).toHaveTextContent("remove");
    });
    expect(from.restore).not.toHaveBeenCalled();
    expect(screen.queryByText(/A change couldn't be saved/)).not.toBeInTheDocument();
  });
});
