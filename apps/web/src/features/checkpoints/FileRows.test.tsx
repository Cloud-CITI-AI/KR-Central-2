import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { PROBLEM_TYPES } from "@kr/contracts";
import { useJob } from "@/features/tracker";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { FileRows } from "./FileRows";
import { syntheticFile } from "./test-fixtures";
import { checkpointOf, renderWithJob, withCheckpoint } from "./test-utils";

const viewer = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/features/viewer", () => ({ useViewer: () => viewer }));

function Rows({ jobId }: { readonly jobId: string }) {
  const { data } = useJob(jobId);
  const files = data ? checkpointOf(data, "i7_1").files : [];
  return <FileRows jobId={jobId} checkpointKey="i7_1" files={files} />;
}

function setup() {
  const base = syntheticJob();
  const files = [
    syntheticFile(base.id, { name: "Agreement.pdf", checkpointKey: "i7_1", slot: "documents" }),
    syntheticFile(base.id, { name: "Annex.pdf", checkpointKey: "i7_1", slot: "documents" }),
  ];
  const job = withCheckpoint(base, "i7_1", { files });
  return { job, files, ...renderWithJob(<Rows jobId={job.id} />, job) };
}

describe("FileRows", () => {
  it("renders nothing for no files", () => {
    const { container } = renderWithJob(<FileRows jobId="x" checkpointKey="i7_1" files={[]} />, syntheticJob());
    expect(container.querySelector("ul")).toBeNull();
  });

  it("opens the viewer on the clicked file with every file of the folder", async () => {
    const { files, container } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Annex.pdf" }));
    expect(viewer.open).toHaveBeenCalledWith(files, 1);
    await expectNoAxeViolations(container);
  });

  it("removes a file after Yes, at once, and refreshes the job", async () => {
    const { job, files, served } = setup();
    const gone: string[] = [];
    server.use(
      handlerFor("deleteFile", ({ params }) => {
        gone.push(String(params.fileId));
        served.job = withCheckpoint(job, "i7_1", { files: files.slice(1) });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Agreement.pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Agreement.pdf" })).not.toBeInTheDocument();
    });
    expect(gone).toEqual([files[0]?.id]);
    expect(screen.getByRole("button", { name: "Annex.pdf" })).toBeInTheDocument();
  });

  it("puts the file back and shows the save-failed banner when removal fails", async () => {
    setup();
    server.use(mockProblem("deleteFile", 500));
    await userEvent.click(screen.getByRole("button", { name: "Remove Agreement.pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText(/A change couldn't be saved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agreement.pdf" })).toBeInTheDocument();
  });

  it("drops a file that someone else already removed without a banner", async () => {
    const { job, files, served } = setup();
    server.use(mockProblem("deleteFile", 404, PROBLEM_TYPES.notFound));
    await userEvent.click(screen.getByRole("button", { name: "Remove Agreement.pdf" }));
    served.job = withCheckpoint(job, "i7_1", { files: files.slice(1) });
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Agreement.pdf" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/couldn't be saved/)).not.toBeInTheDocument();
    expect(within(document.body).getAllByRole("button", { name: "Annex.pdf" })).toHaveLength(1);
  });
});
