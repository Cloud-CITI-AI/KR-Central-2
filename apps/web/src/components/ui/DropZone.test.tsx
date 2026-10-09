import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { DropZone } from "./DropZone";

const pdf = (name = "Decision Letter.pdf", size = 10) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });
const LABEL = "Drag and drop the WAPC conditional approval PDF here";
const zone = () => document.querySelector("label") as HTMLElement;

function drop(files: File[]) {
  const event = createEvent.drop(zone());
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  fireEvent(zone(), event);
}

describe("DropZone", () => {
  it("shows the label and hint, with a labelled hidden file input that keyboard users can reach", async () => {
    const { container } = render(
      <DropZone label={LABEL} hint="then extract its conditions" onFiles={() => undefined} />,
    );
    expect(screen.getByText("then extract its conditions")).toBeInTheDocument();
    const input = screen.getByLabelText(new RegExp(LABEL));
    expect(input).toHaveAttribute("type", "file");
    await userEvent.tab();
    expect(input).toHaveFocus();
    await expectNoAxeViolations(container);
  });

  it("passes chosen files on and lets the same file be chosen again", async () => {
    const onFiles = vi.fn();
    render(<DropZone label={LABEL} onFiles={onFiles} accept={[".pdf"]} />);
    const input = screen.getByLabelText<HTMLInputElement>(new RegExp(LABEL));
    const file = pdf();
    await userEvent.upload(input, file);
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(input.value).toBe("");
    await userEvent.upload(input, file);
    expect(onFiles).toHaveBeenCalledTimes(2);
  });

  it("accepts dropped files and shows the drop target state while dragging over", () => {
    const onFiles = vi.fn();
    render(<DropZone label={LABEL} onFiles={onFiles} />);
    const dragOver = createEvent.dragOver(zone());
    fireEvent(zone(), dragOver);
    expect(dragOver.defaultPrevented).toBe(true);
    drop([pdf("a.pdf"), pdf("b.pdf")]);
    expect(onFiles).toHaveBeenCalledWith([
      expect.objectContaining({ name: "a.pdf" }),
      expect.objectContaining({ name: "b.pdf" }),
    ]);
  });

  it("lists oversized and wrong-type files under the zone with the spec texts, and passes on the rest", () => {
    const onFiles = vi.fn();
    render(
      <DropZone
        label={LABEL}
        onFiles={onFiles}
        accept={[".pdf", "image/*"]}
        acceptDescription="PDF or photo"
        maxBytes={1024}
      />,
    );
    const ok = pdf("ok.pdf", 100);
    drop([ok, pdf("big.pdf", 5000), new File(["x"], "plan.dwg")]);
    expect(onFiles).toHaveBeenCalledWith([ok]);
    expect(screen.getByText("big.pdf is larger than 0 MB")).toBeInTheDocument();
    expect(screen.getByText("plan.dwg isn't a supported type for this box (use PDF or photo)")).toBeInTheDocument();
    drop([new File(["x"], "b.dwg")]);
    expect(onFiles).toHaveBeenCalledTimes(1); // nothing accepted, so no call
  });

  it.each([{}, { disabled: false }])("shows Uploading… instead of the label while busy (%j)", (props) => {
    const onFiles = vi.fn();
    render(<DropZone label={LABEL} hint="PDF" onFiles={onFiles} busy {...props} />);
    const input = screen.getByLabelText(/Uploading…/);
    expect(screen.getByRole("status")).toHaveTextContent("Uploading…");
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(input).toBeDisabled();
    drop([pdf()]);
    fireEvent.change(input, { target: { files: [pdf()] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("ignores everything when disabled", () => {
    const onFiles = vi.fn();
    render(<DropZone label={LABEL} onFiles={onFiles} disabled />);
    const dragOver = createEvent.dragOver(zone());
    fireEvent(zone(), dragOver);
    expect(dragOver.defaultPrevented).toBe(false);
    drop([pdf()]);
    expect(onFiles).not.toHaveBeenCalled();
  });
});
