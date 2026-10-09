import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticJob, type SyntheticJobOptions } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticFile } from "./test-fixtures";
import { stubUploads } from "./test-upload";
import { renderCard, withCheckpoint } from "./test-utils";

const viewer = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/features/viewer", () => ({ useViewer: () => viewer }));
afterEach(() => {
  vi.unstubAllGlobals();
});

function withFiles(key: string, files: readonly { name: string; slot: string }[], options?: SyntheticJobOptions) {
  const base = syntheticJob(options);
  return withCheckpoint(base, key, {
    files: files.map((f) => syntheticFile(base.id, { ...f, checkpointKey: key })),
  });
}

describe("documents panel (7.1 Water Corporation agreement)", () => {
  it("shows the titled folder as not received yet with its drop zone", async () => {
    const { container } = renderCard(syntheticJob(), "i7_1");
    expect(screen.getByText("Water Corporation Agreement")).toBeInTheDocument();
    expect(screen.getByText("not received yet")).toBeInTheDocument();
    expect(screen.getByText("Drag and drop the Water Corporation Agreement PDF here")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open all" })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("counts the files, lists them and opens the viewer on the first one with Open all", async () => {
    const job = withFiles("i7_1", [
      { name: "Agreement.pdf", slot: "documents" },
      { name: "Annex.pdf", slot: "documents" },
    ]);
    renderCard(job, "i7_1");
    expect(screen.getByText("2 files")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open all" }));
    expect(viewer.open).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "Agreement.pdf" })]),
      0,
    );
    await userEvent.click(screen.getByRole("button", { name: "Annex.pdf" }));
    expect(viewer.open).toHaveBeenLastCalledWith(expect.anything(), 1);
  });

  it("says 1 file for one file and offers no Open all", () => {
    renderCard(withFiles("i7_1", [{ name: "Agreement.pdf", slot: "documents" }]), "i7_1");
    expect(screen.getByText("1 file")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open all" })).not.toBeInTheDocument();
  });

  it("uploads into the slot of the definition", async () => {
    const requests = stubUploads();
    renderCard(syntheticJob(), "i7_1");
    await userEvent.upload(
      screen.getByLabelText(/Drag and drop the Water Corporation Agreement PDF here/),
      new File(["%PDF"], "Agreement.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => {
      expect(requests[0]?.fields).toEqual({ checkpointKey: "i7_1", slot: "documents", file: "Agreement.pdf" });
    });
  });

  it("shows no drop zone to a client, who may not upload into a staff slot, but still lists the files", () => {
    const job = withFiles("i7_1", [{ name: "Agreement.pdf", slot: "documents" }], {
      role: "external",
      grantRole: "client",
    });
    renderCard(job, "i7_1");
    expect(screen.queryByText(/Drag and drop/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agreement.pdf" })).toBeInTheDocument();
  });
});

describe("clearance panel (7.6)", () => {
  it("is the agency's clearance folder with the PDF-or-image zone", () => {
    renderCard(syntheticJob(), "i7_6");
    expect(screen.getByText("Water Corporation clearance")).toBeInTheDocument();
    expect(screen.getByText("not received yet")).toBeInTheDocument();
    expect(screen.getByText("Drag and drop the Water Corporation clearance here")).toBeInTheDocument();
    expect(screen.getByText("PDF or image – or click to choose")).toBeInTheDocument();
  });

  it("offers Open all only for more than one file", () => {
    renderCard(
      withFiles("i7_6", [
        { name: "Clearance.pdf", slot: "clearance" },
        { name: "Clearance 2.pdf", slot: "clearance" },
      ]),
      "i7_6",
    );
    expect(screen.getByRole("button", { name: "Open all" })).toBeInTheDocument();
  });
});

describe("slots panel (6.8 Western Power clearance)", () => {
  it("shows both requirement chips as required, one sub-folder and zone per slot", async () => {
    const { container } = renderCard(syntheticJob(), "i6_9");
    expect(screen.getByText("Western Power clearance")).toBeInTheDocument();
    expect(screen.getByText("not received yet")).toBeInTheDocument();
    expect(screen.getByText("Clearance PDF required")).toBeInTheDocument();
    expect(screen.getByText("Clearance email (as PDF) required")).toBeInTheDocument();
    expect(screen.getByText("Drag and drop the Western Power clearance PDF here")).toBeInTheDocument();
    expect(screen.getByText("Drag and drop the clearance email, saved as a PDF, here")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("turns a chip green once its slot has a file, and lists each file in its own sub-folder", () => {
    renderCard(withFiles("i6_9", [{ name: "Clearance.pdf", slot: "clr" }]), "i6_9");
    expect(screen.getByText("✓ Clearance PDF received")).toBeInTheDocument();
    expect(screen.getByText("Clearance email (as PDF) required")).toBeInTheDocument();
    expect(screen.getByText("1 file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clearance.pdf" })).toBeInTheDocument();
  });

  it("lists a file whose slot no longer exists under Other files", () => {
    renderCard(withFiles("i6_9", [{ name: "Legacy.pdf", slot: "old_slot" }]), "i6_9");
    const other = screen.getByText("Other files").parentElement;
    expect(other && within(other).getByRole("button", { name: "Legacy.pdf" })).toBeInTheDocument();
  });

  it("uploads each file into its own slot", async () => {
    const requests = stubUploads();
    renderCard(syntheticJob(), "i6_9");
    await userEvent.upload(
      screen.getByLabelText(/Drag and drop the clearance email, saved as a PDF, here/),
      new File(["%PDF"], "Email.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => {
      expect(requests[0]?.fields.slot).toBe("clremail");
    });
  });
});

describe("slots panel for the client (7.3 plumber documents)", () => {
  it("shows a client both zones and an architect none", () => {
    const client = renderCard(syntheticJob({ role: "external", grantRole: "client" }), "i7_3");
    expect(screen.getByText("Drag and drop the Certificate of Completion here")).toBeInTheDocument();
    expect(screen.getByText("Drag and drop the As-Con / Flimsy here")).toBeInTheDocument();
    client.unmount();
    renderCard(syntheticJob({ role: "external", grantRole: "architect" }), "i7_3");
    expect(screen.queryByText(/Drag and drop/)).not.toBeInTheDocument();
    expect(screen.getByText("Certificate of Completion required")).toBeInTheDocument();
  });
});
