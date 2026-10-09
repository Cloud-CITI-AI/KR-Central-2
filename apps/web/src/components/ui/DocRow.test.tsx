import type { FileMeta } from "@kr/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { DocRow } from "./DocRow";

const file = (overrides: Partial<FileMeta> = {}): FileMeta => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  jobId: "0f8fad5b-d9cb-469f-a165-70867728950f",
  checkpointKey: null,
  conditionId: null,
  slot: null,
  name: "Decision Letter.pdf",
  kind: "pdf",
  contentType: "application/pdf",
  sizeBytes: 100,
  scanStatus: "clean",
  uploadedAt: "2026-09-28T03:50:56.543Z",
  uploadedBy: null,
  canDelete: true,
  email: null,
  ...overrides,
});
const row = (props: Partial<React.ComponentProps<typeof DocRow>> = {}) => {
  const onOpen = vi.fn();
  const onRemove = vi.fn();
  const view = render(
    <ul>
      <DocRow file={file()} onOpen={onOpen} onRemove={onRemove} {...props} />
    </ul>,
  );
  return { ...view, onOpen, onRemove };
};

describe("DocRow: clean file", () => {
  it("shows the extension badge and name, and opens the viewer from the name", async () => {
    const { container, onOpen } = row();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Decision Letter.pdf" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: "Decision Letter.pdf" }));
    expect(screen.queryByRole("status")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("asks 'Remove? Yes / No' inline: No is focused, No cancels and returns focus, Yes removes", async () => {
    const { onRemove } = row();
    await userEvent.click(screen.getByRole("button", { name: "Remove Decision Letter.pdf" }));
    expect(screen.getByText(/Remove\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove Decision Letter.pdf" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Remove Decision Letter.pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
  });

  it("has no remove control when the person may not delete it, and disables it while removing", () => {
    const first = row({ file: file({ canDelete: false }) });
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    first.unmount();
    row({ removing: true });
    expect(screen.getByRole("button", { name: "Remove Decision Letter.pdf" })).toBeDisabled();
  });
});

describe("DocRow: scan states (PRODUCT_SPEC §5.5)", () => {
  it("pending shows 'Scanning…' and can still be opened (the viewer explains)", () => {
    row({ file: file({ scanStatus: "pending" }) });
    expect(screen.getByRole("status")).toHaveTextContent("Scanning…");
    expect(screen.getByRole("button", { name: "Decision Letter.pdf" })).toBeEnabled();
  });

  it("infected shows 'Blocked – failed the virus scan' and cannot be opened", async () => {
    const { container } = row({ file: file({ scanStatus: "infected" }) });
    expect(screen.getByRole("status")).toHaveTextContent("Blocked – failed the virus scan");
    expect(screen.queryByRole("button", { name: "Decision Letter.pdf" })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("a scan error shows the retry-exhausted text and cannot be opened, but can be removed", () => {
    row({ file: file({ scanStatus: "error" }) });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn't be checked for viruses – remove it and upload it again",
    );
    expect(screen.queryByRole("button", { name: "Decision Letter.pdf" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Decision Letter.pdf" })).toBeInTheDocument();
  });

  it("skipped (scanning disabled locally) behaves like clean", () => {
    row({ file: file({ scanStatus: "skipped" }) });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Decision Letter.pdf" })).toBeEnabled();
  });
});
