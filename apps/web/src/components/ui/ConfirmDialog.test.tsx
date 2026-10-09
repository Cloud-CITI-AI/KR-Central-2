import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { ConfirmDialog } from "./ConfirmDialog";

const setup = (props: { busy?: boolean } = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <ConfirmDialog open title="Archive job" confirmLabel="ARCHIVE" onConfirm={onConfirm} onCancel={onCancel} {...props}>
      Archive S-0001? It disappears from the dashboard and job picker for everyone.
    </ConfirmDialog>,
  );
  return { ...view, onConfirm, onCancel };
};

describe("ConfirmDialog", () => {
  it("asks the question with Cancel focused first, so Enter never confirms by accident", async () => {
    const { container } = setup();
    expect(screen.getByRole("dialog", { name: "Archive job" })).toHaveTextContent("Archive S-0001?");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await expectNoAxeViolations(container);
  });

  it("cancels with Enter on the focused Cancel button, and confirms only when Archive is clicked", async () => {
    const { onConfirm, onCancel } = setup();
    await userEvent.keyboard("{Enter}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "ARCHIVE" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables Confirm while busy and renders nothing when closed", () => {
    const busy = setup({ busy: true });
    expect(screen.getByRole("button", { name: "ARCHIVE" })).toBeDisabled();
    busy.unmount();
    render(
      <ConfirmDialog open={false} title="t" confirmLabel="OK" onConfirm={() => undefined} onCancel={() => undefined}>
        hidden
      </ConfirmDialog>,
    );
    expect(screen.queryByText("hidden")).toBeNull();
  });
});
