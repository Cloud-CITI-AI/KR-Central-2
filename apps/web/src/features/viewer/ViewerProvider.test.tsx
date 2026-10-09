import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FileMeta } from "@kr/contracts";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticFile } from "./test-fixtures";

import { useViewer, ViewerProvider } from "./ViewerProvider";

function OpenButtons({ files }: { readonly files: readonly FileMeta[] }) {
  const viewer = useViewer();
  const open = (list: readonly FileMeta[], index: number) => () => {
    viewer.open(list, index);
  };
  return (
    <>
      <button onClick={open(files, 0)}>Open first</button>
      <button onClick={open(files, files.length - 1)}>Open last</button>
      <button onClick={open([], 0)}>Open none</button>
    </>
  );
}

const png = (name: string) => syntheticFile({ name, kind: "image", contentType: "image/png" });

function setup(files: readonly FileMeta[]) {
  return render(
    <ViewerProvider>
      <OpenButtons files={files} />
    </ViewerProvider>,
  );
}

describe("ViewerProvider and the viewer dialog", () => {
  it("renders nothing until opened, then a dialog named for the file, with Close focused", async () => {
    const { container } = setup([png("site.png")]);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open first" }));
    const dialog = screen.getByRole("dialog", { name: "site.png" });
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
    expect(within(dialog).getByRole("img", { name: "site.png" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("ignores an empty list", async () => {
    setup([png("a.png")]);
    await userEvent.click(screen.getByRole("button", { name: "Open none" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("with one file shows no ‹ ›, no position and no extra controls", async () => {
    setup([png("only.png")]);
    await userEvent.click(screen.getByRole("button", { name: "Open first" }));
    expect(screen.queryByRole("button", { name: "Previous file" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next file" })).toBeNull();
    expect(screen.queryByText(/ of /)).toBeNull();
  });

  it("opens at the given index, shows 'n of m' and steps with ‹ and ›, disabling them at the ends", async () => {
    setup([png("a.png"), png("b.png"), png("c.png")]);
    await userEvent.click(screen.getByRole("button", { name: "Open last" }));
    expect(screen.getByRole("dialog", { name: "c.png" })).toBeInTheDocument();
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next file" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous file" }));
    expect(screen.getByRole("dialog", { name: "b.png" })).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous file" }));
    expect(screen.getByRole("dialog", { name: "a.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous file" })).toBeDisabled();
  });

  it("closes with Close and returns focus to the control that opened it", async () => {
    setup([png("a.png")]);
    await userEvent.click(screen.getByRole("button", { name: "Open first" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Open first" })).toHaveFocus();
  });

  it("closes on Esc (the native close path) and returns focus", async () => {
    setup([png("a.png")]);
    await userEvent.click(screen.getByRole("button", { name: "Open first" }));
    const dialog = screen.getByRole("dialog");
    // jsdom does not turn Esc into a close, so do what the browser does: close the dialog and fire `close`.
    act(() => {
      dialog.removeAttribute("open");
      dialog.dispatchEvent(new Event("close"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Open first" })).toHaveFocus();
  });

  it("traps Tab and Shift+Tab inside the dialog", async () => {
    setup([png("a.png"), png("b.png")]);
    await userEvent.click(screen.getByRole("button", { name: "Open first" }));
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Close" });
    const next = within(dialog).getByRole("button", { name: "Next file" });
    close.focus();
    await userEvent.tab();
    expect(next).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(close).toHaveFocus();
  });

  it("offers 'Open in new tab' to the inline content", async () => {
    const image = png("site.png");
    setup([image]);
    await userEvent.click(screen.getByRole("button", { name: "Open first" }));
    const link = screen.getByRole("link", { name: "Open in new tab" });
    expect(link).toHaveAttribute("href", `/api/v1/files/${image.id}/content`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
