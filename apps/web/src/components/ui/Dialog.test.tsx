import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { Dialog } from "./Dialog";

function Harness({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </button>
      <Dialog
        open={open}
        title="Job details"
        onClose={() => {
          setOpen(false);
          onClose();
        }}
      >
        <input aria-label="Address" />
        <button>Save</button>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("is closed and renders no content until opened, then labelled by its title with the first control focused", async () => {
    const { container } = render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Address")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Job details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await expectNoAxeViolations(container);
  });

  it("closes with the Close button and returns focus to the control that opened it", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Esc (the native cancel/close path) and returns focus", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    // jsdom does not turn Esc into a close, so do what the browser does: close the dialog and fire `close`.
    screen.getByRole("dialog").removeAttribute("open");
    screen.getByRole("dialog", { hidden: true }).dispatchEvent(new Event("close"));
    expect(await screen.findByRole("button", { name: "Open" })).toHaveFocus();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab and Shift+Tab inside the dialog", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const close = screen.getByRole("button", { name: "Close" });
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(save).toHaveFocus();
  });
});
