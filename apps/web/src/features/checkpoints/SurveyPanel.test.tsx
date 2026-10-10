import type { FileMeta } from "@kr/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticFile } from "./test-fixtures";
import { stubUploads } from "./test-upload";
import { renderCard, withCheckpoint } from "./test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

function survey(names: readonly string[], scanStatus: FileMeta["scanStatus"] = "clean") {
  const base = syntheticJob();
  return withCheckpoint(base, "i2_0", {
    files: names.map((name) => syntheticFile(base.id, { name, checkpointKey: "i2_0", slot: "survey", scanStatus })),
  });
}

describe("survey panel (2.0)", () => {
  it("starts empty with both chips required and the PDF-and-DWG zone", async () => {
    const { container } = renderCard(syntheticJob(), "i2_0");
    expect(screen.getByText("Feature survey")).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.getByText("PDF required")).toBeInTheDocument();
    expect(screen.getByText("DWG required")).toBeInTheDocument();
    expect(screen.getByText("Drag and drop the feature survey PDF and DWG here")).toBeInTheDocument();
    expect(screen.getByText("both files are required – or click to choose")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("turns the PDF chip green with a PDF and the DWG chip with a DWG, judged by the file kind", () => {
    const pdfOnly = renderCard(survey(["Survey.pdf"]), "i2_0");
    expect(screen.getByText("✓ PDF received")).toBeInTheDocument();
    expect(screen.getByText("DWG required")).toBeInTheDocument();
    expect(screen.getByText("1 file")).toBeInTheDocument();
    pdfOnly.unmount();
    renderCard(survey(["Survey.pdf", "Survey.dwg"]), "i2_0");
    expect(screen.getByText("✓ PDF received")).toBeInTheDocument();
    expect(screen.getByText("✓ DWG received")).toBeInTheDocument();
    expect(screen.getByText("2 files")).toBeInTheDocument();
  });

  it.each(["infected", "error"] as const)(
    "does not count a %s file as received: it cannot be opened, so the chip stays required",
    (scanStatus) => {
      renderCard(survey(["Survey.pdf"], scanStatus), "i2_0");
      expect(screen.getByText("PDF required")).toBeInTheDocument();
      expect(screen.queryByText("✓ PDF received")).not.toBeInTheDocument();
    },
  );

  it.each(["pending", "skipped"] as const)("counts a %s file as received", (scanStatus) => {
    renderCard(survey(["Survey.pdf"], scanStatus), "i2_0");
    expect(screen.getByText("✓ PDF received")).toBeInTheDocument();
  });

  it("accepts only PDF and DWG: the picker filter and the client-side check", async () => {
    const requests = stubUploads();
    renderCard(syntheticJob(), "i2_0");
    const input = screen.getByLabelText(/Drag and drop the feature survey PDF and DWG here/);
    expect(input).toHaveAttribute("accept", ".pdf,.dwg");
    await userEvent.upload(input, new File(["AC1027"], "Survey.dwg", { type: "" }));
    await waitFor(() => {
      expect(requests[0]?.fields).toEqual({ checkpointKey: "i2_0", slot: "survey", file: "Survey.dwg" });
    });
  });

  it("refuses a dropped file that is neither PDF nor DWG without sending it", async () => {
    const requests = stubUploads();
    renderCard(syntheticJob(), "i2_0");
    const zone = screen.getByText("Drag and drop the feature survey PDF and DWG here").closest("label");
    expect(zone).not.toBeNull();
    fireEvent.drop(zone as HTMLElement, {
      dataTransfer: { files: [new File(["x"], "Photo.png", { type: "image/png" })] },
    });
    expect(
      await screen.findByText("Photo.png isn't a supported type for this box (use PDF or DWG)"),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });
});
