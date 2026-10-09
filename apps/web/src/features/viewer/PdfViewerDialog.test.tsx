import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PdfDocumentHandle, PdfPageHandle } from "./pdf-renderer";
import { renderViewer } from "./test-utils";
import { syntheticFile } from "./test-fixtures";
import { useViewer, ViewerProvider } from "./ViewerProvider";

const file = syntheticFile({ name: "plan.pdf" });

function Opener() {
  const viewer = useViewer();
  return (
    <button
      onClick={() => {
        viewer.open([file], 0);
      }}
    >
      Open plan
    </button>
  );
}

describe("a PDF in the viewer dialog", () => {
  it("loads the reader lazily and shows the pages with Open in new tab", async () => {
    const document: PdfDocumentHandle = {
      pageCount: 2,
      page: vi.fn((): Promise<PdfPageHandle> => new Promise(() => undefined)),
      destroy: vi.fn(() => Promise.resolve()),
    };
    renderViewer(
      <ViewerProvider pdfRenderer={{ open: () => Promise.resolve(document) }}>
        <Opener />
      </ViewerProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open plan" }));
    expect(screen.getByRole("dialog", { name: "plan.pdf" })).toBeInTheDocument();
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in new tab" })).toHaveAttribute(
      "href",
      `/api/v1/files/${file.id}/content`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.destroy).toHaveBeenCalledTimes(1);
  });
});
