import type { FileMeta } from "@kr/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { FileList } from "./FileList";

const make = (id: string, name: string): FileMeta => ({
  id,
  jobId: "0f8fad5b-d9cb-469f-a165-70867728950f",
  checkpointKey: null,
  conditionId: null,
  slot: null,
  name,
  kind: "pdf",
  contentType: "application/pdf",
  sizeBytes: 1,
  scanStatus: "clean",
  scanRetriesExhausted: false,
  uploadedAt: "2026-09-28T03:50:56.543Z",
  uploadedBy: null,
  canDelete: true,
  email: null,
});

describe("FileList", () => {
  it("lists every file and routes open and remove to the right file", async () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const files = [make("a", "One.pdf"), make("b", "Two.pdf")];
    const { container } = render(
      <FileList files={files} onOpen={onOpen} onRemove={onRemove} removing={new Set(["b"])} />,
    );
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Two.pdf" }));
    expect(onOpen).toHaveBeenCalledWith(files[1]);
    expect(screen.getByRole("button", { name: "Remove Two.pdf" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Remove One.pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onRemove).toHaveBeenCalledWith(files[0]);
    await expectNoAxeViolations(container);
  });
});
