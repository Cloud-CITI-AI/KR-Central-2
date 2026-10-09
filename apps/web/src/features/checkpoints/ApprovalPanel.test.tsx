import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { syntheticFile } from "./test-fixtures";
import { stubUploads } from "./test-upload";
import { renderCard, withCheckpoint } from "./test-utils";

const viewer = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/features/viewer", () => ({ useViewer: () => viewer }));
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("approval panel: the document folder", () => {
  it("shows the folder as empty with the zone, and its files with Open all once there are some", async () => {
    const job = syntheticJob();
    const empty = renderCard(job, "i1_0p");
    expect(screen.getByText("Fee proposal documents")).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.getByText("Drag and drop fee proposal documents here")).toBeInTheDocument();
    expect(screen.getByText("or click to choose files")).toBeInTheDocument();
    empty.unmount();
    const withOne = withCheckpoint(job, "i1_0p", {
      files: [syntheticFile(job.id, { name: "Proposal.pdf", checkpointKey: "i1_0p", slot: "documents" })],
    });
    renderCard(withOne, "i1_0p");
    expect(screen.getByText("1 file")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open all" }));
    expect(viewer.open).toHaveBeenCalledWith(expect.anything(), 0);
  });

  it("shows the folder's hint, not a zone, to a viewer who cannot upload while it is empty", () => {
    renderCard(syntheticJob({ role: "external", grantRole: "client" }), "i1_0p");
    expect(screen.getByText("Upload the fee proposal here for the client to review.")).toBeInTheDocument();
    expect(screen.queryByText(/Drag and drop/)).not.toBeInTheDocument();
  });

  it("has no folder for 9.1, only the decision", () => {
    renderCard(syntheticJob(), "i9_1");
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept quote" })).toBeInTheDocument();
  });

  it("3.0 has the completed letter of consent as its folder, which a client can fill", async () => {
    const requests = stubUploads();
    const job = syntheticJob({ role: "external", grantRole: "client" });
    renderCard(job, "i3_0p");
    expect(screen.getByText("Completed letter of consent")).toBeInTheDocument();
    expect(screen.getByText("not received yet")).toBeInTheDocument();
    expect(screen.getByText("or click to choose a PDF or photo of the signed letter")).toBeInTheDocument();
    await userEvent.upload(
      screen.getByLabelText(/Drag and drop the completed letter of consent here/),
      new File(["%PDF"], "Consent.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => {
      expect(requests[0]?.fields).toEqual({ checkpointKey: "i3_0p", slot: "consent", file: "Consent.pdf" });
    });
  });

  it("counts the consent letters as received", () => {
    const job = syntheticJob();
    renderCard(
      withCheckpoint(job, "i3_0p", {
        files: [syntheticFile(job.id, { name: "Consent.pdf", checkpointKey: "i3_0p", slot: "consent" })],
      }),
      "i3_0p",
    );
    expect(screen.getByText("1 file received")).toBeInTheDocument();
  });
});
