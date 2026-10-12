import type { FileMeta } from "@kr/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

// WCAG 2.4.3: the row that had the focus is gone after "Remove? Yes", and the focus must not fall back to the page body.
describe("FileList after a removal is confirmed", () => {
  /** A folder like the tracker's: the rows drop out of the list as soon as they are removed, with a drop zone beside them. */
  function Folder({ names }: { readonly names: readonly string[] }) {
    const [files, setFiles] = useState(() => names.map((name) => make(name, name)));
    return (
      <div>
        <FileList
          files={files}
          onOpen={() => undefined}
          onRemove={(file) => {
            setFiles((current) => current.filter((f) => f.id !== file.id));
          }}
        />
        <label>
          Add a file
          <input type="file" />
        </label>
      </div>
    );
  }
  const remove = async (name: string) => {
    await userEvent.click(screen.getByRole("button", { name: `Remove ${name}` }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
  };

  it("moves focus to the next row", async () => {
    render(<Folder names={["One.pdf", "Two.pdf", "Three.pdf"]} />);
    await remove("Two.pdf");
    expect(screen.queryByRole("button", { name: "Two.pdf" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Three.pdf" })).toHaveFocus();
  });

  it("moves focus to the previous row when the last row was removed", async () => {
    render(<Folder names={["One.pdf", "Two.pdf"]} />);
    await remove("Two.pdf");
    expect(screen.getByRole("button", { name: "One.pdf" })).toHaveFocus();
  });

  it("moves focus to the folder's drop zone when no row is left", async () => {
    render(<Folder names={["One.pdf"]} />);
    await remove("One.pdf");
    expect(screen.getByLabelText("Add a file")).toHaveFocus();
  });

  it("still returns focus to × when the answer is No", async () => {
    render(<Folder names={["One.pdf", "Two.pdf"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove One.pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(screen.getByRole("button", { name: "Remove One.pdf" })).toHaveFocus();
  });
});
